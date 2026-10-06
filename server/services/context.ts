import type { CatalogAdapter } from '../ebay/types';
import type { SourceMode } from '../domain/types';
import type { MemoryStore } from '../store/memory-store';

export interface ServiceContext {
  store: MemoryStore;
  adapter: CatalogAdapter;
  sourceMode: SourceMode;
  marketplaceId: string;
  // null이면 집계만 하고 제한하지 않는다 (샘플 모드)
  budgetLimit: number | null;
  ttlSeconds: number;
  now: Date;
}
