import type { SortKey } from '../domain/types';

export type { Money, RawItemSummary } from '../../shared/types';
import type { RawItemSummary } from '../../shared/types';

export interface SearchParams {
  q: string;
  minPrice?: string;
  maxPrice?: string;
  sort: SortKey;
  offset: number;
  limit: number;
}

export interface SearchPage {
  items: RawItemSummary[];
  total: number;
}

export interface CatalogAdapter {
  readonly provider: 'mock' | 'ebay';
  search(params: SearchParams): Promise<SearchPage>;
  getItem(itemId: string): Promise<RawItemSummary | null>;
}
