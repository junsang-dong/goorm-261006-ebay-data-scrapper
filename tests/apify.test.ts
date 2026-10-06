import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeImport, centsStats } from '../shared/apify/analyze';
import { parseApifyDataset, usdToCents } from '../shared/apify/parse';

const NOW = new Date('2026-10-06T07:00:00Z');

const card = (overrides: Record<string, unknown> = {}) => ({
  itemId: '100',
  title: '2024 Halcyon Chrome Mateo Okafor #42 Refractor',
  url: 'https://www.ebay.com/itm/100',
  categoryPath: 'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Trading Card Singles',
  buyingFormat: 'fixed_price',
  priceValue: 4.5,
  shippingType: 'free',
  scrapedAt: '2026-10-06T06:45:00.000Z',
  sellerUsername: 'should-not-appear',
  quantitySold: 13637,
  itemSpecifics: { Sport: 'Baseball', 'Player/Athlete': 'Mateo Okafor', Season: '2024', 'Card Number': '42', Condition: 'Ungraded - Near mint or better' },
  ...overrides,
});

describe('price parsing', () => {
  it('converts USD text to integer cents without float math', () => {
    expect(usdToCents('$4.49')).toBe(449);
    expect(usdToCents('$1,234.5')).toBe(123450);
    expect(usdToCents('$7')).toBe(700);
    expect(usdToCents('US $4.49')).toBeNull();
    expect(usdToCents('$1.234')).toBeNull();
  });
});

describe('parseApifyDataset', () => {
  it('rejects non-array input', () => {
    expect(() => parseApifyDataset({ items: [] })).toThrow(/배열/);
  });

  it('skips broken, duplicate and nameless records with a reason', () => {
    const result = parseApifyDataset([card(), 'junk', card({ itemId: '' }), card({ title: '' }), card({ itemId: '100' })]);
    expect(result.items).toHaveLength(1);
    expect(result.skipped.map((s) => s.reason)).toEqual(['not_object', 'missing_item_id', 'missing_title', 'duplicate_item_id']);
  });

  it('never keeps seller identity or sold-history fields on the parsed item', () => {
    const { items } = parseApifyDataset([card()]);
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('should-not-appear');
    expect(serialized).not.toContain('quantitySold');
    expect(serialized).not.toContain('13637');
  });

  it('classifies scope, price kind, shipping and condition', () => {
    const { items } = parseApifyDataset([
      card({ itemId: '1' }),
      card({ itemId: '2', categoryPath: 'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Trading Card Lots' }),
      card({ itemId: '3', categoryPath: "Clothing, Shoes & Accessories > Men > Wallets" }),
      card({ itemId: '4', buyingFormat: 'auction', priceValue: undefined, buy_box: { bidPrice: { price: '$3.00' } } }),
      card({ itemId: '5', priceValue: undefined, shippingType: undefined, buy_box: { binModel: { price: '$12.99' }, deliveryInfo: { deliveryMessage: ['Est. delivery Fri'] } }, itemSpecifics: { Condition: 'Graded - SGC 8. Professionally graded', 'Professional Grader': 'SGC' } }),
    ]);
    const byId = Object.fromEntries(items.map((i) => [i.itemId, i]));
    expect(byId['1'].scope).toBe('singles');
    expect(byId['2'].scope).toBe('lot');
    expect(byId['3'].scope).toBe('off_topic');
    expect(byId['4'].priceKind).toBe('auction');
    expect(byId['4'].priceCents).toBeNull();
    expect(byId['1'].shipping).toBe('free');
    expect(byId['5'].shipping).toBe('unknown');
    expect(byId['5'].priceCents).toBe(1299);
    expect(byId['5'].condition).toBe('graded');
    expect(byId['5'].fields.grader).toBe('SGC');
  });

  it('shortens long grader labels and treats "not professionally graded" as ungraded', () => {
    const { items } = parseApifyDataset([
      card({ itemId: '1', itemSpecifics: { 'Professional Grader': 'PROFESSIONAL SPORTS AUTHENTICATOR (PSA)', Grade: '10', Condition: 'Graded - PSA 10' } }),
      card({ itemId: '2', itemSpecifics: { 'Professional Grader': 'NOT PROFESSIONALLY GRADED', Condition: 'Ungraded' } }),
    ]);
    expect(items[0].fields.grader).toBe('PSA');
    expect(items[0].fields.graded).toBe(true);
    expect(items[1].fields.grader).toBeNull();
    expect(items[1].fields.graded).toBe(false);
  });

  it('keeps only eBay https URLs', () => {
    const { items } = parseApifyDataset([card({ url: 'https://evil.example/itm/1' }), card({ itemId: '9', url: 'https://www.ebay.com/itm/9' })]);
    expect(items[0].url).toBeNull();
    expect(items[1].url).toBe('https://www.ebay.com/itm/9');
  });
});

describe('analyzeImport', () => {
  it('computes median and mean in cents over fixed-price singles only', () => {
    const parsed = parseApifyDataset([
      card({ itemId: '1', priceValue: 1 }),
      card({ itemId: '2', priceValue: 2 }),
      card({ itemId: '3', priceValue: 4 }),
      card({ itemId: '4', priceValue: 100, categoryPath: 'Sports Mem > Sports Trading Cards > Trading Card Lots' }),
    ]);
    const report = analyzeImport(parsed, NOW);
    expect(report.pricing.stats).toMatchObject({ count: 3, minCents: 100, medianCents: 200, meanCents: 233, maxCents: 400 });
    expect(report.scope).toEqual({ singles: 3, lots: 1, offTopic: 0 });
  });

  it('computes medians for even counts without float drift', () => {
    expect(centsStats([199, 200])?.medianCents).toBe(200);
    expect(centsStats([])).toBeNull();
  });

  it('warns when the oldest observation is more than six hours old', () => {
    const report = analyzeImport(parseApifyDataset([card()]), new Date('2026-10-06T13:00:00Z'));
    expect(report.freshness?.withinSixHours).toBe(false);
    expect(report.notes.some((n) => n.includes('6시간'))).toBe(true);
  });

  it('keeps seller names out of the printed report', () => {
    const report = analyzeImport(parseApifyDataset([card()]), NOW);
    expect(JSON.stringify(report)).not.toContain('should-not-appear');
  });
});

// 실제 Apify 파일이 있을 때만 검증한다 (저장소에 없으면 건너뜀)
const REAL_FILE = join(process.cwd(), 'xref', 'D06 DATA APIFY dataset_ebay-search-scraper-ppe_2026-10-06_06-46-35-618.json');
describe.skipIf(!existsSync(REAL_FILE))('real Apify export', () => {
  it('matches the known composition of the 66-record sample', () => {
    const data: unknown = JSON.parse(readFileSync(REAL_FILE, 'utf8'));
    const parsed = parseApifyDataset(data);
    const report = analyzeImport(parsed, NOW);
    expect(report.records).toBe(66);
    expect(report.skipped).toBe(0);
    expect(report.scope).toEqual({ singles: 54, lots: 10, offTopic: 2 });
    // 판매자 계정명을 테스트 코드에 적지 않고, 파일에서 읽어 결과에 없는지 확인한다
    const sellers = (data as { sellerUsername?: string }[]).map((r) => r.sellerUsername).filter((s): s is string => Boolean(s));
    expect(sellers.length).toBeGreaterThan(0);
    for (const seller of new Set(sellers)) {
      expect(JSON.stringify(report)).not.toContain(seller);
    }
  });
});
