import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Listing, SearchCriteria } from '../domain/types';
import { toListing } from '../ebay/mapping';
import { ApiError } from '../lib/errors';
import { compareDecimal } from '../lib/decimal';
import { reserveCalls } from '../policies/budget';
import { isExpired } from '../policies/retention';
import type { SavedSearch } from '../store/memory-store';
import { listingKey } from '../store/memory-store';
import type { ServiceContext } from './context';

export const priceSchema = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, '가격은 USD 숫자(소수 2자리 이하)여야 합니다.');

export const listingFilterSchema = z.object({
  q: z.string().max(200).optional(),
  sport: z.string().max(40).optional(),
  grader: z.string().max(20).optional(),
  graded: z.enum(['true', 'false']).optional(),
  matchStatus: z.enum(['ok', 'needs_review']).optional(),
  minPrice: priceSchema.optional(),
  maxPrice: priceSchema.optional(),
});

export type ListingFilters = z.infer<typeof listingFilterSchema>;

export function matchesFilters(listing: Listing, f: ListingFilters): boolean {
  if (f.q) {
    const haystack = `${listing.title} ${listing.player ?? ''}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => haystack.includes(t))) return false;
  }
  if (f.sport && listing.sport !== f.sport) return false;
  if (f.grader && listing.grader !== f.grader) return false;
  if (f.graded && String(listing.graded) !== f.graded) return false;
  if (f.matchStatus && listing.matchStatus !== f.matchStatus) return false;
  if (f.minPrice && compareDecimal(listing.askingPrice, f.minPrice) < 0) return false;
  if (f.maxPrice && compareDecimal(listing.askingPrice, f.maxPrice) > 0) return false;
  return true;
}

// 현재 모드 + 만료되지 않은 매물만 보인다. 샘플과 실데이터는 서로 섞이지 않는다.
export function visibleListings(ctx: ServiceContext): Listing[] {
  return [...ctx.store.listings.values()].filter(
    (listing) => listing.sourceMode === ctx.sourceMode && !isExpired(listing, ctx.now),
  );
}

export const listSortSchema = z.enum(['observed_desc', 'price_asc', 'price_desc', 'title_asc']).default('observed_desc');

function sortListings(items: Listing[], sort: z.infer<typeof listSortSchema>): Listing[] {
  const copy = [...items];
  switch (sort) {
    case 'price_asc':
      return copy.sort((a, b) => compareDecimal(a.askingPrice, b.askingPrice));
    case 'price_desc':
      return copy.sort((a, b) => compareDecimal(b.askingPrice, a.askingPrice));
    case 'title_asc':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return copy.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }
}

export function listListings(
  ctx: ServiceContext,
  filters: ListingFilters,
  sort: z.infer<typeof listSortSchema>,
  page: number,
  pageSize: number,
) {
  const matched = sortListings(visibleListings(ctx).filter((l) => matchesFilters(l, filters)), sort);
  const start = (page - 1) * pageSize;
  return {
    items: matched.slice(start, start + pageSize),
    page,
    pageSize,
    total: matched.length,
  };
}

export function getListing(ctx: ServiceContext, id: string): Listing {
  const listing = [...ctx.store.listings.values()].find(
    (l) => l.id === id && l.sourceMode === ctx.sourceMode,
  );
  if (!listing) throw new ApiError('NOT_FOUND', '매물을 찾을 수 없습니다.', 404);
  if (isExpired(listing, ctx.now)) {
    throw new ApiError('CACHE_EXPIRED', '표시 기간이 지나 매물을 제거했습니다. 다시 조회해 주세요.', 410, true);
  }
  return listing;
}

export function deleteListing(ctx: ServiceContext, id: string): void {
  const listing = getListing(ctx, id);
  ctx.store.listings.delete(listingKey(listing));
  for (const item of ctx.store.jobItems.values()) {
    if (item.listingId === id) item.listingId = null;
  }
}

// 상세 갱신: 현재 캐시를 교체한다. 비활성/삭제 응답은 구분해서 알려준다.
export async function refreshListing(ctx: ServiceContext, id: string): Promise<Listing> {
  const existing = [...ctx.store.listings.values()].find(
    (l) => l.id === id && l.sourceMode === ctx.sourceMode,
  );
  if (!existing) throw new ApiError('NOT_FOUND', '매물을 찾을 수 없습니다.', 404);
  reserveCalls(ctx.store, ctx.adapter.provider, ctx.now, 1, ctx.budgetLimit);
  const raw = await ctx.adapter.getItem(existing.ebayItemId);
  if (!raw) throw new ApiError('ITEM_UNAVAILABLE', '매물이 비활성화되었거나 삭제되었습니다.', 404);
  const listing = toListing(raw, {
    id,
    sourceMode: ctx.sourceMode,
    marketplaceId: ctx.marketplaceId,
    now: ctx.now,
    ttlSeconds: ctx.ttlSeconds,
  });
  ctx.store.listings.set(listingKey(listing), listing);
  return listing;
}

export const searchCriteriaSchema = z
  .object({
    q: z.string().trim().min(2).max(200),
    minPrice: priceSchema.optional(),
    maxPrice: priceSchema.optional(),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'ending_soon']).default('relevance'),
    gradedOnly: z.boolean().optional(),
  })
  .refine((v) => !v.minPrice || !v.maxPrice || compareDecimal(v.minPrice, v.maxPrice) <= 0, {
    message: 'min 가격은 max 가격보다 클 수 없습니다.',
  });

export type SearchInput = z.infer<typeof searchCriteriaSchema>;

// 검색 미리보기: 저장하지 않는다. total은 '검색 결과 참고치'다.
export async function previewSearch(ctx: ServiceContext, criteria: SearchInput, offset: number, limit: number) {
  reserveCalls(ctx.store, ctx.adapter.provider, ctx.now, 1, ctx.budgetLimit);
  const page = await ctx.adapter.search({ ...criteria, offset, limit });
  const items = page.items.map((raw) =>
    toListing(raw, {
      id: randomUUID(),
      sourceMode: ctx.sourceMode,
      marketplaceId: ctx.marketplaceId,
      now: ctx.now,
      ttlSeconds: ctx.ttlSeconds,
    }),
  );
  const nextOffset = offset + page.items.length;
  return {
    items,
    totalHint: page.total,
    nextOffset: nextOffset < page.total && page.items.length > 0 ? nextOffset : null,
    warnings: page.total > limit * 10 ? ['검색 결과 수는 참고치이며 전체 시장을 보장하지 않습니다.'] : [],
  };
}

export function criteriaFromInput(input: SearchInput): SearchCriteria {
  return {
    q: input.q,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    sort: input.sort,
    gradedOnly: input.gradedOnly,
  };
}

export function createSavedSearch(ctx: ServiceContext, name: string, criteria: SearchCriteria): SavedSearch {
  const now = ctx.now.toISOString();
  const saved: SavedSearch = {
    id: randomUUID(),
    name,
    sourceMode: ctx.sourceMode,
    criteria,
    createdAt: now,
    updatedAt: now,
  };
  ctx.store.savedSearches.set(saved.id, saved);
  return saved;
}

export function listSavedSearches(ctx: ServiceContext): SavedSearch[] {
  return [...ctx.store.savedSearches.values()].filter((s) => s.sourceMode === ctx.sourceMode);
}

export function deleteSavedSearch(ctx: ServiceContext, id: string): void {
  const saved = ctx.store.savedSearches.get(id);
  if (!saved || saved.sourceMode !== ctx.sourceMode) {
    throw new ApiError('NOT_FOUND', '저장된 검색 조건을 찾을 수 없습니다.', 404);
  }
  ctx.store.savedSearches.delete(id);
}
