import { randomUUID } from 'node:crypto';
import type { CollectionJob, JobItem, SearchCriteria } from '../domain/types';
import { TERMINAL_JOB_STATUSES } from '../domain/types';
import { ApiError } from '../lib/errors';
import { reserveCalls } from '../policies/budget';
import { toListing } from '../ebay/mapping';
import { listingKey } from '../store/memory-store';
import type { ServiceContext } from './context';

const LEASE_MS = 20_000;
const SEARCH_PAGE_SIZE = 50;
const DETAIL_BATCH = 5;
const DETAIL_CONCURRENCY = 2;

export interface CreateJobInput {
  criteria: SearchCriteria;
  maxItems: number;
  idempotencyKey?: string;
}

const itemKey = (jobId: string, ebayItemId: string) => `${jobId}|${ebayItemId}`;

function isTerminal(job: CollectionJob): boolean {
  return TERMINAL_JOB_STATUSES.includes(job.status);
}

// await 중에 다른 요청이 취소할 수 있으므로 타입 좁히기 대신 함수로 다시 확인한다.
function isCancelled(job: CollectionJob): boolean {
  return job.status === 'cancelled';
}

export function getJobOrThrow(ctx: ServiceContext, jobId: string): CollectionJob {
  const job = ctx.store.jobs.get(jobId);
  if (!job) throw new ApiError('NOT_FOUND', '수집 작업을 찾을 수 없습니다.', 404);
  return job;
}

function pendingItems(ctx: ServiceContext, jobId: string): JobItem[] {
  const items: JobItem[] = [];
  for (const item of ctx.store.jobItems.values()) {
    if (item.jobId === jobId && item.status === 'pending') items.push(item);
  }
  return items;
}

export function createJob(ctx: ServiceContext, input: CreateJobInput): CollectionJob {
  if (input.idempotencyKey) {
    const existingId = ctx.store.idempotency.get(input.idempotencyKey);
    if (existingId) return getJobOrThrow(ctx, existingId);
  }
  const nowIso = ctx.now.toISOString();
  const job: CollectionJob = {
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey ?? null,
    status: 'queued',
    sourceMode: ctx.sourceMode,
    criteria: input.criteria,
    maxItems: input.maxItems,
    cursor: 0,
    searchExhausted: false,
    discovered: 0,
    searchCalls: 0,
    detailCalls: 0,
    savedCount: 0,
    failedCount: 0,
    leaseUntil: null,
    nextRetryAt: null,
    errorCode: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  ctx.store.jobs.set(job.id, job);
  if (input.idempotencyKey) ctx.store.idempotency.set(input.idempotencyKey, job.id);
  return job;
}

// 검색 페이지 1개 또는 상세 최대 5건을 처리한다. 같은 step을 다시 호출해도 결과가 같아야 한다.
export async function stepJob(ctx: ServiceContext, jobId: string): Promise<{ job: CollectionJob; done: boolean }> {
  const job = getJobOrThrow(ctx, jobId);
  if (isTerminal(job)) return { job, done: true };

  const nowMs = ctx.now.getTime();
  if (job.nextRetryAt && Date.parse(job.nextRetryAt) > nowMs) {
    return { job, done: false };
  }
  if (job.leaseUntil !== null && job.leaseUntil > nowMs) {
    throw new ApiError('JOB_LEASE_HELD', '다른 실행이 이 작업을 처리 중입니다.', 409, true);
  }

  job.leaseUntil = nowMs + LEASE_MS;
  job.status = 'running';
  job.updatedAt = ctx.now.toISOString();

  try {
    const pending = pendingItems(ctx, job.id);
    if (pending.length > 0) {
      await processDetails(ctx, job, pending.slice(0, DETAIL_BATCH));
    } else if (!job.searchExhausted) {
      await fetchSearchPage(ctx, job);
    }
    if (!isCancelled(job) && job.searchExhausted && pendingItems(ctx, job.id).length === 0) {
      finalize(job);
    }
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'EBAY_RATE_LIMITED' || error.code === 'BUDGET_EXCEEDED')) {
      // 기록만 하고 중단한다. 장시간 대기는 하지 않는다.
      job.status = 'paused';
      job.errorCode = error.code;
      job.nextRetryAt = error.code === 'EBAY_RATE_LIMITED' ? new Date(nowMs + 60_000).toISOString() : null;
    } else {
      throw error;
    }
  } finally {
    job.leaseUntil = null;
    job.updatedAt = ctx.now.toISOString();
  }
  return { job, done: isTerminal(job) };
}

async function fetchSearchPage(ctx: ServiceContext, job: CollectionJob): Promise<void> {
  reserveCalls(ctx.store, ctx.adapter.provider, ctx.now, 1, ctx.budgetLimit);
  const { q, minPrice, maxPrice, sort } = job.criteria;
  const page = await ctx.adapter.search({
    q,
    minPrice,
    maxPrice,
    sort: sort ?? 'relevance',
    offset: job.cursor,
    limit: SEARCH_PAGE_SIZE,
  });
  if (isCancelled(job)) return;

  job.searchCalls++;
  job.cursor += page.items.length;
  for (const raw of page.items) {
    if (job.discovered >= job.maxItems) break;
    const key = itemKey(job.id, raw.itemId);
    if (ctx.store.jobItems.has(key)) continue;
    ctx.store.jobItems.set(key, {
      jobId: job.id,
      ebayItemId: raw.itemId,
      status: 'pending',
      listingId: null,
      errorCode: null,
    });
    job.discovered++;
  }
  if (page.items.length === 0 || job.cursor >= page.total || job.discovered >= job.maxItems) {
    job.searchExhausted = true;
  }
}

async function processDetails(ctx: ServiceContext, job: CollectionJob, batch: JobItem[]): Promise<void> {
  for (let i = 0; i < batch.length; i += DETAIL_CONCURRENCY) {
    await Promise.all(batch.slice(i, i + DETAIL_CONCURRENCY).map((item) => processItem(ctx, job, item)));
  }
}

async function processItem(ctx: ServiceContext, job: CollectionJob, item: JobItem): Promise<void> {
  reserveCalls(ctx.store, ctx.adapter.provider, ctx.now, 1, ctx.budgetLimit);
  job.detailCalls++;
  try {
    const raw = await ctx.adapter.getItem(item.ebayItemId);
    if (isCancelled(job)) return;
    if (!raw) throw new ApiError('ITEM_UNAVAILABLE', '매물이 더 이상 조회되지 않습니다.', 404);

    const key = listingKey({ sourceMode: ctx.sourceMode, marketplaceId: ctx.marketplaceId, ebayItemId: raw.itemId });
    const existing = ctx.store.listings.get(key);
    const listing = toListing(raw, {
      id: existing?.id ?? randomUUID(),
      sourceMode: ctx.sourceMode,
      marketplaceId: ctx.marketplaceId,
      now: ctx.now,
      ttlSeconds: ctx.ttlSeconds,
    });
    ctx.store.listings.set(key, listing); // 현재 캐시를 교체한다 (upsert)
    item.status = 'completed';
    item.listingId = listing.id;
    item.errorCode = null;
    job.savedCount = countCompleted(ctx, job.id);
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'EBAY_RATE_LIMITED' || error.code === 'BUDGET_EXCEEDED')) {
      throw error; // 항목은 pending으로 남겨 재개 시 다시 시도한다
    }
    item.status = 'failed';
    item.errorCode = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    job.failedCount = countStatus(ctx, job.id, 'failed');
  }
}

function countStatus(ctx: ServiceContext, jobId: string, status: JobItem['status']): number {
  let count = 0;
  for (const item of ctx.store.jobItems.values()) {
    if (item.jobId === jobId && item.status === status) count++;
  }
  return count;
}

function countCompleted(ctx: ServiceContext, jobId: string): number {
  return countStatus(ctx, jobId, 'completed');
}

function finalize(job: CollectionJob): void {
  if (job.savedCount === 0 && job.failedCount > 0) job.status = 'failed';
  else if (job.failedCount > 0) job.status = 'partial';
  else job.status = 'completed';
}

export function cancelJob(ctx: ServiceContext, jobId: string): CollectionJob {
  const job = getJobOrThrow(ctx, jobId);
  if (isTerminal(job)) return job;
  job.status = 'cancelled';
  job.nextRetryAt = null;
  job.updatedAt = ctx.now.toISOString();
  return job;
}

// 만료된 lease를 회수하고 중단 지점부터 이어서 처리할 수 있게 한다.
export function resumeJob(ctx: ServiceContext, jobId: string): CollectionJob {
  const job = getJobOrThrow(ctx, jobId);
  if (isTerminal(job)) {
    throw new ApiError('JOB_NOT_RESUMABLE', '완료되었거나 중단된 작업은 재개할 수 없습니다.', 409);
  }
  if (job.leaseUntil !== null && job.leaseUntil > ctx.now.getTime()) {
    throw new ApiError('JOB_LEASE_HELD', '다른 실행이 이 작업을 처리 중입니다.', 409, true);
  }
  job.leaseUntil = null;
  job.nextRetryAt = null;
  job.errorCode = null;
  job.status = 'queued';
  job.updatedAt = ctx.now.toISOString();
  return job;
}
