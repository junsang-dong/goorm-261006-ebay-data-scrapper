import type { Listing, SourceMode } from '../domain/types';
import { normalizeFields } from '../normalization/normalize';
import type { RawItemSummary } from './types';

export interface MappingContext {
  id: string;
  sourceMode: SourceMode;
  marketplaceId: string;
  now: Date;
  ttlSeconds: number;
}

// 허용 호스트 검증: eBay 도메인의 https URL만 링크로 쓴다.
export function validateEbayUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const allowed = url.hostname === 'ebay.com' || url.hostname.endsWith('.ebay.com');
    return url.protocol === 'https:' && allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toListing(raw: RawItemSummary, ctx: MappingContext): Listing {
  const fields = normalizeFields(raw);
  const shippingOption = raw.shippingOptions?.find((option) => option.shippingCost);
  const observedAt = ctx.now.toISOString();
  const expiresAt = new Date(ctx.now.getTime() + ctx.ttlSeconds * 1000).toISOString();

  if (raw.condition || raw.conditionId) {
    fields.fieldProvenance.condition = 'api_condition';
  }

  return {
    id: ctx.id,
    sourceMode: ctx.sourceMode,
    marketplaceId: ctx.marketplaceId,
    ebayItemId: raw.itemId,
    legacyItemId: raw.legacyItemId ?? null,
    title: raw.title,
    itemUrl: ctx.sourceMode === 'mock' ? null : validateEbayUrl(raw.itemWebUrl),
    imageUrl: raw.image?.imageUrl ?? null,
    categoryId: raw.categoryId ?? null,
    conditionId: raw.conditionId ?? null,
    conditionLabel: raw.condition ?? null,
    buyingOptions: raw.buyingOptions ?? [],
    askingPrice: raw.price.value,
    currency: raw.price.currency,
    shippingCost: shippingOption?.shippingCost?.value ?? null,
    shippingCurrency: shippingOption?.shippingCost?.currency ?? null,
    locationCountry: raw.itemLocation?.country ?? null,
    sport: fields.sport,
    player: fields.player,
    team: fields.team,
    manufacturer: fields.manufacturer,
    setName: fields.setName,
    cardNumber: fields.cardNumber,
    seasonYear: fields.seasonYear,
    parallelVariant: fields.parallelVariant,
    language: fields.language,
    graded: fields.graded,
    grader: fields.grader,
    grade: fields.grade,
    certificationNumber: fields.certificationNumber,
    isLot: fields.isLot,
    isReprint: fields.isReprint,
    matchStatus: fields.matchStatus,
    fieldProvenance: fields.fieldProvenance,
    normalizationWarnings: fields.normalizationWarnings,
    detailStatus: 'complete',
    observedAt,
    expiresAt,
  };
}
