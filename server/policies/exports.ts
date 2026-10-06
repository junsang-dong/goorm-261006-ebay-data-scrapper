import type { Listing } from '../domain/types';
import { ApiError } from '../lib/errors';

export const EXPORT_COLUMNS = [
  'id', 'sourceMode', 'ebayItemId', 'title', 'askingPrice', 'currency',
  'shippingCost', 'shippingCurrency', 'sport', 'player', 'team', 'manufacturer',
  'setName', 'cardNumber', 'seasonYear', 'parallelVariant', 'graded', 'grader',
  'grade', 'certificationNumber', 'isLot', 'isReprint', 'matchStatus', 'itemUrl',
  'observedAt', 'expiresAt',
] as const satisfies readonly (keyof Listing)[];

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

// 실데이터 내보내기는 서버 설정이 켜져 있어야 한다. 샘플은 항상 허용한다.
export function assertExportAllowed(sourceMode: Listing['sourceMode'], liveExportEnabled: boolean): void {
  if (sourceMode !== 'mock' && !liveExportEnabled) {
    throw new ApiError('EXPORT_NOT_ENABLED', '실데이터 내보내기는 허용 조건 확인 후 활성화됩니다.', 403);
  }
}

// 수식 삽입 방어: =, +, -, @ (및 탭·CR)로 시작하는 텍스트는 앞에 작은따옴표를 붙인다.
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(listings: Listing[]): string {
  const header = EXPORT_COLUMNS.join(',');
  const rows = listings.map((listing) => EXPORT_COLUMNS.map((col) => escapeCsvCell(listing[col])).join(','));
  return `﻿${[header, ...rows].join('\r\n')}`;
}

export function buildJson(listings: Listing[]): string {
  const normalized = listings.map((listing) =>
    Object.fromEntries(EXPORT_COLUMNS.map((col) => [col, listing[col]])),
  );
  return JSON.stringify(normalized, null, 2);
}
