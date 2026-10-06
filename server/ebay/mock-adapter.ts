import { compareDecimal } from '../lib/decimal';
import { MOCK_CATALOG } from '../mocks/fixtures';
import type { CatalogAdapter, RawItemSummary, SearchPage, SearchParams } from './types';

// 독립 제작 샘플 데이터만 사용한다. 네트워크 호출·비밀키가 필요 없다.
function matchesQuery(item: RawItemSummary, q: string): boolean {
  const haystack = item.title.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function compareItems(sort: SearchParams['sort']): ((a: RawItemSummary, b: RawItemSummary) => number) | null {
  switch (sort) {
    case 'price_asc':
      return (a, b) => compareDecimal(a.price.value, b.price.value);
    case 'price_desc':
      return (a, b) => compareDecimal(b.price.value, a.price.value);
    case 'ending_soon':
      return null;
    default:
      return null;
  }
}

export const mockAdapter: CatalogAdapter = {
  provider: 'mock',

  async search(params: SearchParams): Promise<SearchPage> {
    let matched = MOCK_CATALOG.filter((item) => matchesQuery(item, params.q));
    if (params.minPrice) {
      matched = matched.filter((item) => compareDecimal(item.price.value, params.minPrice!) >= 0);
    }
    if (params.maxPrice) {
      matched = matched.filter((item) => compareDecimal(item.price.value, params.maxPrice!) <= 0);
    }
    const comparator = compareItems(params.sort);
    if (comparator) matched = [...matched].sort(comparator);

    return {
      total: matched.length,
      items: matched.slice(params.offset, params.offset + params.limit),
    };
  },

  async getItem(itemId: string): Promise<RawItemSummary | null> {
    return MOCK_CATALOG.find((item) => item.itemId === itemId) ?? null;
  },
};
