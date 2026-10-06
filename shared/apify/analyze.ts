import type { ImportedItem, ParseResult } from './parse';

// 가격 통계는 모두 정수 센트로 계산한다. 표시할 때만 달러 문자열로 바꾼다.

export interface CentsStats {
  count: number;
  minCents: number;
  medianCents: number;
  meanCents: number;
  maxCents: number;
}

export interface GroupStat {
  label: string;
  count: number;
  medianCents: number | null;
}

export interface CoverageRow {
  key: string;
  label: string;
  filled: number;
  total: number;
  rate: number; // 0~1
}

export interface CheapestRow {
  itemId: string;
  title: string;
  priceCents: number;
  url: string | null;
  flags: string[];
}

export interface ImportReport {
  generatedAt: string;
  records: number;
  parsed: number;
  skipped: number;
  scope: { singles: number; lots: number; offTopic: number };
  pricing: {
    fixedSingles: number;
    auctionSingles: number;
    unpricedSingles: number;
    stats: CentsStats | null;
    byCondition: GroupStat[];
    byGrader: GroupStat[];
    topParallels: GroupStat[];
  };
  shipping: { free: number; unknown: number };
  coverage: CoverageRow[];
  review: { needsReview: number; lotCandidates: number; reprintCandidates: number };
  cheapest: CheapestRow[];
  freshness: { oldestScrapedAt: string; ageHours: number; withinSixHours: boolean } | null;
  notes: string[];
}

export function centsStats(values: number[]): CentsStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    minCents: sorted[0],
    medianCents: median,
    meanCents: Math.round(sum / sorted.length),
    maxCents: sorted[sorted.length - 1],
  };
}

function groupBy(items: ImportedItem[], keyOf: (item: ImportedItem) => string, limit?: number): GroupStat[] {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key) ?? [];
    if (item.priceCents !== null) list.push(item.priceCents);
    groups.set(key, list);
  }
  const rows = [...groups.entries()].map(([label, prices]) => ({
    label,
    count: prices.length,
    medianCents: centsStats(prices)?.medianCents ?? null,
  }));
  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return limit ? rows.slice(0, limit) : rows;
}

const COVERAGE_FIELDS: { key: keyof ImportedItem['fields']; label: string }[] = [
  { key: 'sport', label: '종목' },
  { key: 'player', label: '선수' },
  { key: 'team', label: '팀' },
  { key: 'manufacturer', label: '브랜드' },
  { key: 'setName', label: '세트' },
  { key: 'seasonYear', label: '연도' },
  { key: 'cardNumber', label: '카드 번호' },
  { key: 'parallelVariant', label: '판본' },
  { key: 'grader', label: '인증 기관' },
];

export function analyzeImport(parsed: ParseResult, now: Date): ImportReport {
  const all = parsed.items;
  const singles = all.filter((i) => i.scope === 'singles');
  const fixed = singles.filter((i) => i.priceKind === 'fixed' && i.priceCents !== null);
  const fixedPrices = fixed.map((i) => i.priceCents as number);

  const scrapedTimes = all.map((i) => i.scrapedAt).filter((v): v is string => Boolean(v)).sort();
  const oldest = scrapedTimes[0] ?? null;
  const ageHours = oldest ? (now.getTime() - Date.parse(oldest)) / 3_600_000 : null;

  const coverage = COVERAGE_FIELDS.map(({ key, label }) => {
    const filled = singles.filter((i) => i.fields[key] !== null).length;
    return { key: String(key), label, filled, total: singles.length, rate: singles.length ? filled / singles.length : 0 };
  });

  const cheapest: CheapestRow[] = [...fixed]
    .sort((a, b) => (a.priceCents as number) - (b.priceCents as number))
    .slice(0, 10)
    .map((i) => ({
      itemId: i.itemId,
      title: i.title,
      priceCents: i.priceCents as number,
      url: i.url,
      flags: [
        ...(i.fields.graded ? ['graded'] : []),
        ...(i.fields.matchStatus === 'needs_review' ? ['needs_review'] : []),
        ...i.fields.normalizationWarnings,
      ],
    }));

  const notes = [
    '이 데이터는 등록 가격 관측입니다. 판매 완료 가격이나 시세가 아닙니다.',
    'quantitySold(판매 완료 수량) 필드는 판매 완료 이력이므로 읽지 않았습니다.',
    '판매자 계정명·계정 정보는 읽지 않았고 결과에도 넣지 않았습니다.',
    '입찰만 있는 경매 매물은 등록 가격이 아니므로 가격 통계에서 제외했습니다.',
    '“Free shipping” 문구가 있는 매물만 무료 배송으로 보았고, 나머지는 배송비 미상입니다.',
    '카드가 아닌 카테고리 매물은 분석에서 제외했습니다.',
  ];
  if (ageHours !== null && ageHours > 6) {
    notes.push(`가장 오래된 관측이 ${ageHours.toFixed(1)}시간 전입니다. 표시 기준(6시간)을 넘었으니 다시 수집하세요.`);
  }

  return {
    generatedAt: now.toISOString(),
    records: parsed.totalRecords,
    parsed: all.length,
    skipped: parsed.skipped.length,
    scope: {
      singles: singles.length,
      lots: all.filter((i) => i.scope === 'lot').length,
      offTopic: all.filter((i) => i.scope === 'off_topic').length,
    },
    pricing: {
      fixedSingles: fixed.length,
      auctionSingles: singles.filter((i) => i.priceKind === 'auction').length,
      unpricedSingles: singles.filter((i) => i.priceCents === null && i.priceKind !== 'auction').length,
      stats: centsStats(fixedPrices),
      byCondition: groupBy(fixed, (i) => i.condition),
      byGrader: groupBy(fixed, (i) => i.fields.grader ?? '인증 없음'),
      topParallels: groupBy(fixed, (i) => i.fields.parallelVariant ?? '판본 미확인', 10),
    },
    shipping: {
      free: singles.filter((i) => i.shipping === 'free').length,
      unknown: singles.filter((i) => i.shipping === 'unknown').length,
    },
    coverage,
    review: {
      needsReview: singles.filter((i) => i.fields.matchStatus === 'needs_review').length,
      lotCandidates: all.filter((i) => i.fields.isLot).length,
      reprintCandidates: all.filter((i) => i.fields.isReprint).length,
    },
    cheapest,
    freshness: oldest && ageHours !== null
      ? { oldestScrapedAt: oldest, ageHours: Math.round(ageHours * 10) / 10, withinSixHours: ageHours <= 6 }
      : null,
    notes,
  };
}

// 표시용 달러 문자열 (예: 12345 → "$123.45")
export function formatCents(cents: number | null): string {
  if (cents === null) return '-';
  const whole = Math.floor(cents / 100).toLocaleString('en-US');
  return `$${whole}.${String(cents % 100).padStart(2, '0')}`;
}
