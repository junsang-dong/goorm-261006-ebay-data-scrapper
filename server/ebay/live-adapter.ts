import { ApiError } from '../lib/errors';
import type { CatalogAdapter } from './types';

// 실데이터 어댑터 자리. 운영 접근 승인 전까지는 호출하지 않고 명확한 오류를 돌려준다.
// OAuth 발급·Browse 호출은 승인 조건 확인 후 이 파일에 구현한다 (SPEC 3.2, 9.2).
function notReady(): never {
  throw new ApiError(
    'EBAY_ACCESS_NOT_READY',
    'eBay 운영 접근이 아직 승인되지 않았습니다. 샘플 모드를 사용하세요.',
    503,
  );
}

export const liveAdapter: CatalogAdapter = {
  provider: 'ebay',
  async search() {
    return notReady();
  },
  async getItem() {
    return notReady();
  },
};
