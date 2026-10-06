import { normalizeFields, type NormalizedFields } from '../normalize';
import type { RawItemSummary } from '../types';

// Apify eBay 검색 스크래퍼 결과(JSON 배열)를 읽는다.
// 판매 완료 수량(quantitySold)과 판매자 식별 정보(seller*)는 읽지 않는다 (SPEC 3.3, 6.1).

export const MAX_RECORDS = 5000;

export type PriceKind = 'fixed' | 'auction' | 'missing';
export type ShippingKind = 'free' | 'unknown';
export type ConditionGroup = 'graded' | 'raw' | 'used' | 'new' | 'other';
export type Scope = 'singles' | 'lot' | 'off_topic';

export interface ImportedItem {
  itemId: string;
  title: string;
  url: string | null;
  categoryPath: string;
  scope: Scope;
  priceCents: number | null;
  priceKind: PriceKind;
  shipping: ShippingKind;
  condition: ConditionGroup;
  endDate: string | null;
  scrapedAt: string | null;
  fields: NormalizedFields;
}

export interface SkippedRecord {
  index: number;
  reason: 'not_object' | 'missing_item_id' | 'missing_title' | 'duplicate_item_id';
}

export interface ParseResult {
  items: ImportedItem[];
  skipped: SkippedRecord[];
  totalRecords: number;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// "$4.49" 같은 USD 문자열을 정수 센트로 바꾼다. 형식이 다르면 null (float 계산을 하지 않는다).
export function usdToCents(value: string): number | null {
  const match = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.replace(/,/g, '').trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}

const ALLOWED_HOST = /^https:\/\/([a-z0-9-]+\.)*ebay\.com\//i;

function specificsOf(r: Obj): Obj {
  return isObj(r.itemSpecifics) ? r.itemSpecifics : {};
}

function buyBoxOf(r: Obj): Obj {
  return isObj(r.buy_box) ? r.buy_box : {};
}

function priceOf(r: Obj): { cents: number | null; kind: PriceKind } {
  const buyingFormat = text(r.buyingFormat);
  const currency = text(r.currency);
  if (currency && currency.toUpperCase() !== 'USD') return { cents: null, kind: 'missing' };

  if (typeof r.priceValue === 'number' && Number.isFinite(r.priceValue)) {
    const kind: PriceKind = buyingFormat === 'auction' ? 'auction' : 'fixed';
    return { cents: usdToCents(r.priceValue.toFixed(2)), kind };
  }

  const binPrice = text(isObj(buyBoxOf(r).binModel) ? (buyBoxOf(r).binModel as Obj).price : null);
  if (binPrice) return { cents: usdToCents(binPrice), kind: 'fixed' };

  // 입찰만 있는 매물: 현재 입찰가는 등록 가격이 아니므로 가격 통계에서 뺀다
  if (buyingFormat === 'auction' || buyBoxOf(r).bidInfo || buyBoxOf(r).bidPrice) {
    return { cents: null, kind: 'auction' };
  }
  return { cents: null, kind: 'missing' };
}

function shippingOf(r: Obj): ShippingKind {
  if (r.shippingType === 'free' || r.shippingCost === 0) return 'free';
  const info = buyBoxOf(r).deliveryInfo;
  const messages = isObj(info) && Array.isArray(info.deliveryMessage) ? info.deliveryMessage : [];
  return messages.some((m) => typeof m === 'string' && /free shipping/i.test(m)) ? 'free' : 'unknown';
}

function conditionOf(condition: string | null, fields: NormalizedFields): ConditionGroup {
  if (fields.graded === true) return 'graded';
  const c = condition ?? '';
  if (/^graded/i.test(c)) return 'graded';
  if (/^ungraded/i.test(c)) return 'raw';
  if (/^new/i.test(c)) return 'new';
  if (/^(used|pre-owned)/i.test(c)) return 'used';
  return 'other';
}

function scopeOf(categoryPath: string): Scope {
  if (!/Sports Trading Cards/i.test(categoryPath)) return 'off_topic';
  if (/Trading Card Lots/i.test(categoryPath)) return 'lot';
  return 'singles';
}

function toItem(r: Obj): ImportedItem | { reason: SkippedRecord['reason'] } {
  const itemId = typeof r.itemId === 'number' || typeof r.itemId === 'string' ? String(r.itemId).trim() : '';
  if (!itemId) return { reason: 'missing_item_id' };
  const title = text(r.title);
  if (!title) return { reason: 'missing_title' };

  const specifics = specificsOf(r);
  const localizedAspects = Object.entries(specifics).flatMap(([name, value]) => {
    const v = Array.isArray(value) ? value.join(', ') : text(value);
    return v ? [{ name, value: v }] : [];
  });
  const condition = text(specifics.Condition) ?? text(r.condition);
  const categoryPath = text(r.categoryPath) ?? '';

  // 가격은 정제 규칙에 쓰지 않으므로 자리표시 값을 넣는다.
  const raw: RawItemSummary = {
    itemId,
    title,
    price: { value: '0.00', currency: 'USD' },
    localizedAspects,
    condition: condition ?? undefined,
  };
  const fields = normalizeFields(raw);
  const price = priceOf(r);
  const url = text(r.url);

  return {
    itemId,
    title,
    url: url && ALLOWED_HOST.test(url) ? url : null,
    categoryPath,
    scope: scopeOf(categoryPath),
    priceCents: price.cents,
    priceKind: price.kind,
    shipping: shippingOf(r),
    condition: conditionOf(condition, fields),
    endDate: text(r.endDate),
    scrapedAt: text(r.scrapedAt),
    fields,
  };
}

export function parseApifyDataset(data: unknown): ParseResult {
  if (!Array.isArray(data)) {
    throw new Error('Apify 데이터셋은 객체의 배열(JSON array) 형식이어야 합니다.');
  }
  if (data.length > MAX_RECORDS) {
    throw new Error(`한 번에 가져올 수 있는 최대 건수는 ${MAX_RECORDS}건입니다. (현재 ${data.length}건)`);
  }

  const items: ImportedItem[] = [];
  const skipped: SkippedRecord[] = [];
  const seen = new Set<string>();

  data.forEach((record, index) => {
    if (!isObj(record)) {
      skipped.push({ index, reason: 'not_object' });
      return;
    }
    const result = toItem(record);
    if ('reason' in result) {
      skipped.push({ index, reason: result.reason });
      return;
    }
    if (seen.has(result.itemId)) {
      skipped.push({ index, reason: 'duplicate_item_id' });
      return;
    }
    seen.add(result.itemId);
    items.push(result);
  });

  return { items, skipped, totalRecords: data.length };
}
