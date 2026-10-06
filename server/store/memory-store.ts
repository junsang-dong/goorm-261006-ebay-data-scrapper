import type { CollectionJob, JobItem, Listing, SearchCriteria, SourceMode } from '../domain/types';

export interface SavedSearch {
  id: string;
  name: string;
  sourceMode: SourceMode;
  criteria: SearchCriteria;
  createdAt: string;
  updatedAt: string;
}

// 임시 저장소. 로컬 실행과 테스트용이다.
// 서버리스 인스턴스마다 메모리가 달라지므로 운영 배포에는 Neon 구현으로 교체해야 한다 (SPEC 7).
export class MemoryStore {
  listings = new Map<string, Listing>(); // key: sourceMode|marketplace|ebayItemId
  jobs = new Map<string, CollectionJob>();
  jobItems = new Map<string, JobItem>(); // key: jobId|ebayItemId
  idempotency = new Map<string, string>(); // key: idempotencyKey -> jobId
  savedSearches = new Map<string, SavedSearch>();
  usage = new Map<string, number>(); // key: provider|browse|UTC date
  sessions = new Map<string, number>(); // key: sha256(sessionId) -> expiresAt(ms)
  loginFailures = new Map<string, { count: number; resetAt: number }>();
}

export function listingKey(listing: Pick<Listing, 'sourceMode' | 'marketplaceId' | 'ebayItemId'>): string {
  return `${listing.sourceMode}|${listing.marketplaceId}|${listing.ebayItemId}`;
}

export const store = new MemoryStore();
