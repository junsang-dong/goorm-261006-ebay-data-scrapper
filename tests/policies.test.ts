import { describe, expect, it } from 'vitest';
import { buildCsv, escapeCsvCell, assertExportAllowed } from '../server/policies/exports';
import { purgeExpired } from '../server/policies/retention';
import { ApiError, redact } from '../server/lib/errors';
import { makeCtx } from './helpers';
import { createJob, stepJob } from '../server/services/collections';
import type { Listing } from '../server/domain/types';

describe('CSV export safety', () => {
  it('prefixes formula-like text so spreadsheets do not execute it', () => {
    expect(escapeCsvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(escapeCsvCell('+1')).toBe(`'+1`);
    expect(escapeCsvCell('-2')).toBe(`'-2`);
    expect(escapeCsvCell('@cmd')).toBe(`'@cmd`);
  });

  it('quotes commas and newlines and writes a UTF-8 BOM', async () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
    const ctx = makeCtx();
    const job = createJob(ctx, { criteria: { q: 'Halcyon', sort: 'relevance' }, maxItems: 2 });
    for (let i = 0; i < 4; i++) {
      await stepJob(ctx, job.id);
      ctx.now = new Date(ctx.now.getTime() + 1000);
    }
    const csv = buildCsv([...ctx.store.listings.values()] as Listing[]);
    expect(csv.startsWith('﻿')).toBe(true);
  });
});

describe('export gating', () => {
  it('blocks live exports unless the server flag is on', () => {
    expect(() => assertExportAllowed('live', false)).toThrow(ApiError);
    expect(() => assertExportAllowed('live', true)).not.toThrow();
    expect(() => assertExportAllowed('mock', false)).not.toThrow();
  });
});

describe('purge', () => {
  it('removes expired listings and unlinks job items', async () => {
    const ctx = makeCtx({ ttlSeconds: 60 });
    const job = createJob(ctx, { criteria: { q: 'Halcyon', sort: 'relevance' }, maxItems: 3 });
    for (let i = 0; i < 4; i++) {
      await stepJob(ctx, job.id);
      ctx.now = new Date(ctx.now.getTime() + 1000);
    }
    const count = ctx.store.listings.size;
    expect(count).toBeGreaterThan(0);
    const result = purgeExpired(ctx.store, new Date(ctx.now.getTime() + 120_000));
    expect(result.listings).toBe(count);
    expect(ctx.store.listings.size).toBe(0);
    for (const item of ctx.store.jobItems.values()) {
      expect(item.listingId).toBeNull();
    }
  });
});

describe('secret redaction', () => {
  it('masks tokens, bearer values and database URLs in logs', () => {
    const text = 'Bearer abc.def token=xyz postgres://user:pw@host/db';
    const out = redact(text);
    expect(out).not.toContain('abc.def');
    expect(out).not.toContain('xyz');
    expect(out).not.toContain('user:pw');
  });
});
