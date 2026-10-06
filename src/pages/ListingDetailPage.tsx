import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../lib/api-client';
import {
  displayTotal,
  FIELD_LABEL,
  formatKst,
  formatUsd,
  PROVENANCE_LABEL,
  SOURCE_LABEL,
  WARNING_LABEL,
} from '../lib/format';
import type { Listing } from '../types/api';

const ATTRIBUTE_FIELDS = [
  'sport', 'player', 'team', 'manufacturer', 'setName', 'cardNumber', 'seasonYear',
  'parallelVariant', 'language', 'grader', 'grade', 'certificationNumber', 'graded',
] as const;

export default function ListingDetailPage({ id }: { id: string }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
    api
      .listing(id)
      .then((res) => setListing(res.data))
      .catch((err: unknown) => {
        setListing(null);
        setError(err instanceof ApiRequestError ? { code: err.code, message: err.message } : { code: 'UNKNOWN', message: '매물을 불러오지 못했습니다.' });
      });
  }, [id]);

  async function onRefresh() {
    setBusy(true);
    try {
      const res = await api.refreshListing(id);
      setListing(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? { code: err.code, message: err.message } : { code: 'UNKNOWN', message: '갱신에 실패했습니다.' });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm('이 매물 캐시를 삭제할까요? 원문 eBay 매물에는 영향이 없습니다.')) return;
    await api.deleteListing(id);
    window.location.hash = '#/listings';
  }

  if (error) {
    const expired = error.code === 'CACHE_EXPIRED';
    return (
      <section className="page">
        <p className="error" role="alert">{error.message}</p>
        <a href={expired ? '#/search' : '#/listings'}>{expired ? '다시 검색하기' : '저장 데이터로 돌아가기'}</a>
      </section>
    );
  }
  if (!listing) return <p className="muted">불러오는 중…</p>;

  const total = displayTotal(listing);

  return (
    <section className="page detail">
      <a href="#/listings">← 저장 데이터</a>
      <h1>{listing.title}</h1>
      <p className="muted small">
        출처: {SOURCE_LABEL[listing.sourceMode]} · 수집 {formatKst(listing.observedAt)} · 표시 만료 {formatKst(listing.expiresAt)}
      </p>

      <div className="detail-grid">
        {listing.imageUrl ? (
          <img className="detail-image" src={listing.imageUrl} alt={listing.title} onError={(e) => ((e.currentTarget as HTMLImageElement).src = '/placeholder-card.svg')} />
        ) : (
          <img className="detail-image" src="/placeholder-card.svg" alt="이미지 없음" />
        )}

        <div className="card">
          <dl className="kv">
            <dt>등록 가격</dt>
            <dd>{formatUsd(listing.askingPrice, listing.currency)}</dd>
            <dt>배송비</dt>
            <dd>{listing.shippingCost === null ? '미상 (무료 배송 아님)' : formatUsd(listing.shippingCost, listing.shippingCurrency ?? listing.currency)}</dd>
            <dt>상품+표시 배송비</dt>
            <dd>{total ? formatUsd(total, listing.currency) : '계산 불가'}</dd>
            <dt>상태</dt>
            <dd>{listing.conditionLabel ?? '미상'}</dd>
            <dt>구매 방식</dt>
            <dd>{listing.buyingOptions.join(', ') || '미상'}</dd>
            <dt>위치</dt>
            <dd>{listing.locationCountry ?? '미상'}</dd>
          </dl>
          <p className="small muted">등록 가격 기준입니다. 세금·관세·환율·최종 결제금액은 포함하지 않습니다.</p>
          <div className="actions">
            {listing.itemUrl ? (
              <a className="button-link primary" href={listing.itemUrl} target="_blank" rel="noopener noreferrer">
                eBay에서 원문 보기
              </a>
            ) : (
              <span className="muted small">샘플 매물에는 eBay 원문 링크가 없습니다.</span>
            )}
            <button type="button" onClick={onRefresh} disabled={busy}>상세 갱신</button>
            <button type="button" className="danger" onClick={onDelete}>캐시 삭제</button>
          </div>
        </div>
      </div>

      <section className="card" aria-labelledby="attr-heading">
        <h2 id="attr-heading">상품 속성</h2>
        <p className="small muted">‘eBay 속성’은 판매자 정보를 그대로 옮긴 값이고, ‘제목 추정’은 제목 규칙으로 채운 값입니다. 둘은 다르게 볼 수 있습니다.</p>
        <table className="attr-table">
          <thead>
            <tr><th scope="col">항목</th><th scope="col">값</th><th scope="col">출처</th></tr>
          </thead>
          <tbody>
            {ATTRIBUTE_FIELDS.map((field) => {
              const value = listing[field];
              const display = value === null || value === undefined ? '미상' : typeof value === 'boolean' ? (value ? '예' : '아니오') : String(value);
              const source = listing.fieldProvenance[field];
              return (
                <tr key={field}>
                  <th scope="row">{FIELD_LABEL[field]}</th>
                  <td>{display}</td>
                  <td className="small">{source ? PROVENANCE_LABEL[source] : '-'}</td>
                </tr>
              );
            })}
            <tr>
              <th scope="row">{FIELD_LABEL.condition}</th>
              <td>{listing.conditionLabel ?? '미상'}</td>
              <td className="small">{listing.fieldProvenance.condition ? PROVENANCE_LABEL[listing.fieldProvenance.condition] : '-'}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="review-heading">
        <h2 id="review-heading">검토 항목</h2>
        {listing.matchStatus === 'needs_review' ? <p className="tag warn">확인 필요</p> : <p className="muted small">특이 사항 없음</p>}
        {listing.isLot && <p>묶음 매물 후보입니다. 낱장 카드 가격으로 비교하지 마세요.</p>}
        {listing.isReprint && <p>복각 또는 레플리카 후보입니다.</p>}
        <ul>
          {listing.normalizationWarnings.map((w) => (
            <li key={w}>{WARNING_LABEL[w] ?? w}</li>
          ))}
        </ul>
        <p className="small muted">
          PSA·BGS·SGC·CGC 표기는 판매자 제목에서 나온 정보입니다. 기관 검증이나 진품 보증이 아닙니다.
        </p>
      </section>
    </section>
  );
}
