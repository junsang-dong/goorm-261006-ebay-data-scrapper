import type { SortKey } from '../domain/types';

// 앱 정렬 키 → Browse API sort 값. 실제 허용값은 배포 전 공식 문서로 다시 확인한다.
export const EBAY_SORT_MAP: Record<SortKey, string> = {
  relevance: 'BestMatch',
  price_asc: 'PricePlusShippingLowest',
  price_desc: 'PricePlusShippingHighest',
  newest: 'NewlyListed',
  ending_soon: 'EndingSoonest',
};
