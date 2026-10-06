import type { Listing } from '../domain/types';
import type { MemoryStore } from '../store/memory-store';

export function isExpired(listing: Pick<Listing, 'expiresAt'>, now: Date): boolean {
  return new Date(listing.expiresAt).getTime() <= now.getTime();
}

// 만료 매물을 삭제하고, 연결된 작업 항목에서 상품 연결을 끊는다.
// 작업 기록의 집계와 오류 코드만 남긴다.
export function purgeExpired(store: MemoryStore, now: Date): { listings: number; jobItems: number } {
  let listings = 0;
  for (const [key, listing] of store.listings) {
    if (isExpired(listing, now)) {
      store.listings.delete(key);
      listings++;
    }
  }
  let jobItems = 0;
  for (const item of store.jobItems.values()) {
    const listingStillExists = [...store.listings.values()].some((l) => l.id === item.listingId);
    if (item.listingId && !listingStillExists) {
      item.listingId = null;
      jobItems++;
    }
  }
  for (const [hash, expiresAt] of store.sessions) {
    if (expiresAt <= now.getTime()) store.sessions.delete(hash);
  }
  return { listings, jobItems };
}
