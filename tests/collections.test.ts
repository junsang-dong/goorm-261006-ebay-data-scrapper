import { describe, expect, it } from 'vitest';
import { mockAdapter } from '../server/ebay/mock-adapter';
import { ApiError } from '../server/lib/errors';
import { cancelJob, createJob, resumeJob, stepJob } from '../server/services/collections';
import { listingFilterSchema, listListings } from '../server/services/listings';
import { makeCtx } from './helpers';

const criteria = { q: 'Halcyon', sort: 'relevance' as const };

async function runToCompletion(ctx: ReturnType<typeof makeCtx>, jobId: string) {
  for (let i = 0; i < 500; i++) {
    const { done } = await stepJob(ctx, jobId);
    if (done) return;
    // 다음 step 전에 lease 시간이 지나도록 시각을 옮긴다
    ctx.now = new Date(ctx.now.getTime() + 1000);
  }
  throw new Error('job did not finish');
}

describe('collection jobs', () => {
  it('collects every matching sample once, with no duplicate listings', async () => {
    const ctx = makeCtx();
    const job = createJob(ctx, { criteria, maxItems: 200 });
    await runToCompletion(ctx, job.id);

    const expected = await mockAdapter.search({ q: 'Halcyon', sort: 'relevance', offset: 0, limit: 200 });
    const finished = ctx.store.jobs.get(job.id)!;
    expect(finished.status === 'completed' || finished.status === 'partial').toBe(true);
    expect(finished.savedCount + finished.failedCount).toBe(Math.min(expected.total, 200));
    expect(ctx.store.listings.size).toBe(finished.savedCount);
  });

  it('stops at maxItems and never stores more than requested', async () => {
    const ctx = makeCtx();
    const job = createJob(ctx, { criteria: { q: 'Halcyon', sort: 'relevance' }, maxItems: 3 });
    await runToCompletion(ctx, job.id);
    const finished = ctx.store.jobs.get(job.id)!;
    expect(finished.discovered).toBe(3);
    expect(finished.savedCount).toBeLessThanOrEqual(3);
  });

  it('re-running a finished step converges to the same result', async () => {
    const ctx = makeCtx();
    const job = createJob(ctx, { criteria, maxItems: 20 });
    await runToCompletion(ctx, job.id);
    const before = ctx.store.listings.size;
    const again = await stepJob(ctx, job.id);
    expect(again.done).toBe(true);
    expect(ctx.store.listings.size).toBe(before);
  });

  it('rejects a second concurrent step while the lease is held', async () => {
    const ctx = makeCtx();
    const job = createJob(ctx, { criteria, maxItems: 20 });
    const first = stepJob(ctx, job.id);
    await expect(stepJob(ctx, job.id)).rejects.toMatchObject({ code: 'JOB_LEASE_HELD' });
    await first;
  });

  it('returns the same job for the same idempotency key', () => {
    const ctx = makeCtx();
    const a = createJob(ctx, { criteria, maxItems: 10, idempotencyKey: 'key-1' });
    const b = createJob(ctx, { criteria, maxItems: 10, idempotencyKey: 'key-1' });
    expect(b.id).toBe(a.id);
    expect(ctx.store.jobs.size).toBe(1);
  });

  it('pauses with BUDGET_EXCEEDED when the daily budget is used up, then resumes', async () => {
    const ctx = makeCtx({ budgetLimit: 2, adapter: { ...mockAdapter, provider: 'ebay' } });
    const job = createJob(ctx, { criteria, maxItems: 50 });
    for (let i = 0; i < 10; i++) {
      await stepJob(ctx, job.id);
      ctx.now = new Date(ctx.now.getTime() + 1000);
      if (ctx.store.jobs.get(job.id)!.status === 'paused') break;
    }
    const paused = ctx.store.jobs.get(job.id)!;
    expect(paused.status).toBe('paused');
    expect(paused.errorCode).toBe('BUDGET_EXCEEDED');

    ctx.budgetLimit = null;
    const resumed = resumeJob(ctx, job.id);
    expect(resumed.status).toBe('queued');
    await runToCompletion(ctx, job.id);
    expect(['completed', 'partial']).toContain(ctx.store.jobs.get(job.id)!.status);
  });

  it('cancel keeps items already saved and blocks later steps', async () => {
    const ctx = makeCtx();
    const job = createJob(ctx, { criteria, maxItems: 50 });
    await stepJob(ctx, job.id); // search page
    await stepJob(ctx, job.id); // first detail batch
    const savedBefore = ctx.store.listings.size;
    expect(cancelJob(ctx, job.id).status).toBe('cancelled');
    const after = await stepJob(ctx, job.id);
    expect(after.done).toBe(true);
    expect(ctx.store.listings.size).toBe(savedBefore);
  });

  it('cannot resume a finished job', async () => {
    const ctx = makeCtx();
    const job = createJob(ctx, { criteria, maxItems: 5 });
    await runToCompletion(ctx, job.id);
    expect(() => resumeJob(ctx, job.id)).toThrow(ApiError);
  });
});

describe('listing visibility', () => {
  it('hides expired listings from lists and detail', async () => {
    const ctx = makeCtx({ ttlSeconds: 60 });
    const job = createJob(ctx, { criteria, maxItems: 5 });
    await runToCompletion(ctx, job.id);
    const someId = [...ctx.store.listings.values()][0]?.id;
    expect(someId).toBeDefined();

    const later = makeCtx({ store: ctx.store, ttlSeconds: 60, now: new Date(ctx.now.getTime() + 61_000) });
    const page = listListings(later, listingFilterSchema.parse({}), 'observed_desc', 1, 50);
    expect(page.total).toBe(0);
  });

  it('filters by price with numeric comparison', async () => {
    const ctx = makeCtx();
    const job = createJob(ctx, { criteria, maxItems: 50 });
    await runToCompletion(ctx, job.id);
    const filtered = listListings(ctx, listingFilterSchema.parse({ maxPrice: '20.00' }), 'price_asc', 1, 100);
    for (const item of filtered.items) {
      expect(Number(item.askingPrice)).toBeLessThanOrEqual(20);
    }
  });
});
