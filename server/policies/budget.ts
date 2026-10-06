import type { MemoryStore } from '../store/memory-store';
import { ApiError } from '../lib/errors';

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// 호출 예산을 먼저 예약하고 나서 외부 호출을 한다. limit이 null이면 집계만 한다.
export function reserveCalls(
  store: MemoryStore,
  provider: string,
  now: Date,
  count: number,
  limit: number | null,
): number {
  const key = `${provider}|browse|${utcDate(now)}`;
  const used = store.usage.get(key) ?? 0;
  if (limit !== null && used + count > limit) {
    throw new ApiError('BUDGET_EXCEEDED', '오늘의 앱 내부 API 호출 예산을 모두 사용했습니다.', 429, false);
  }
  store.usage.set(key, used + count);
  return used + count;
}

export function usedToday(store: MemoryStore, provider: string, now: Date): number {
  return store.usage.get(`${provider}|browse|${utcDate(now)}`) ?? 0;
}
