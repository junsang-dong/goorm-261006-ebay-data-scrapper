import type { Provenance, SourceMode } from '../types/api';

const SCALE = 10_000n;

// 금액 합산은 float 대신 정수 스케일로 한다 (서버 server/lib/decimal.ts 와 같은 규칙).
function toScaled(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}

function fromScaled(scaled: bigint): string {
  const whole = (scaled / SCALE).toString();
  const fraction = (scaled % SCALE).toString().padStart(4, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${fraction}`;
}

// 같은 통화이고 배송비가 확인된 경우에만 '상품+표시 배송비'를 만든다. 미상이면 null.
export function displayTotal(listing: {
  askingPrice: string;
  currency: string;
  shippingCost: string | null;
  shippingCurrency: string | null;
}): string | null {
  if (listing.shippingCost === null || listing.shippingCurrency !== listing.currency) return null;
  return fromScaled(toScaled(listing.askingPrice) + toScaled(listing.shippingCost));
}

export function formatUsd(value: string | null, currency = 'USD'): string {
  if (value === null) return '미상';
  return `${currency} ${value}`;
}

export function formatKst(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const SOURCE_LABEL: Record<SourceMode, string> = {
  mock: '샘플 데이터',
  live: '실데이터',
  sandbox: '샌드박스',
};

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  api_aspect: 'eBay 속성',
  api_condition: 'eBay 상태',
  title_rule: '제목 추정',
  manual: '수동 입력',
};

export const FIELD_LABEL: Record<string, string> = {
  sport: '종목',
  player: '선수',
  team: '팀',
  manufacturer: '브랜드',
  setName: '세트',
  cardNumber: '카드 번호',
  seasonYear: '연도',
  parallelVariant: '판본',
  language: '언어',
  grader: '인증 기관',
  grade: '등급',
  certificationNumber: '인증 번호',
  graded: '등급 여부',
  condition: '상태',
};

export const WARNING_LABEL: Record<string, string> = {
  grader_conflict: '인증 기관이 속성과 제목에서 다름',
  grade_conflict: '등급이 속성과 제목에서 다름',
  graded_conflict: '등급 여부가 속성과 제목에서 다름',
  season_conflict: '연도가 속성과 제목에서 다름',
  year_ambiguous: '제목에 연도가 여러 개라 연도를 비워 둠',
  lot_candidate: '묶음 매물 후보',
  reprint_candidate: '복각·레플리카 후보',
  player_missing: '선수 정보 없음',
  parallel_missing: '판본 정보 없음 (동일 카드로 확정하지 않음)',
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: '대기',
  running: '진행 중',
  paused: '일시 중지',
  completed: '완료',
  partial: '일부 성공',
  failed: '실패',
  cancelled: '중단됨',
};
