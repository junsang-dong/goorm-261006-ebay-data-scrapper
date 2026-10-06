import type { Listing } from '../types/api';
import { displayTotal, formatKst, formatUsd, PROVENANCE_LABEL } from '../lib/format';

interface Props {
  items: Listing[];
  onOpen?: (id: string) => void;
}

// 데스크톱은 표, 모바일은 세로 카드로 바뀐다 (styles.css 의 .table-wrap / .card-list).
export default function ListingTable({ items, onOpen }: Props) {
  if (items.length === 0) {
    return <p className="muted empty">조건에 맞는 매물이 없습니다.</p>;
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">매물 목록</caption>
          <thead>
            <tr>
              <th scope="col">이미지</th>
              <th scope="col">제목</th>
              <th scope="col">등록 가격</th>
              <th scope="col">상품+표시 배송비</th>
              <th scope="col">인증·등급</th>
              <th scope="col">검토</th>
              <th scope="col">수집 시각 (KST)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><Thumb listing={item} /></td>
                <td>
                  {onOpen ? (
                    <button type="button" className="link" onClick={() => onOpen(item.id)}>
                      {item.title}
                    </button>
                  ) : (
                    item.title
                  )}
                  <div className="muted small">
                    {item.player ?? '선수 미상'} · {item.seasonYear ?? '연도 미상'}
                    {item.grader && (
                      <span className="tag" title={PROVENANCE_LABEL[item.fieldProvenance.grader ?? 'api_aspect']}>
                        {item.grader} {item.grade ?? ''} · {PROVENANCE_LABEL[item.fieldProvenance.grader ?? 'api_aspect']}
                      </span>
                    )}
                  </div>
                </td>
                <td className="num">{formatUsd(item.askingPrice, item.currency)}</td>
                <td className="num">{displayTotal(item) ? formatUsd(displayTotal(item), item.currency) : '배송비 미상'}</td>
                <td>{item.graded === null ? '미확인' : item.graded ? '등급 있음' : '미등급'}</td>
                <td>{item.matchStatus === 'needs_review' ? <span className="tag warn">확인 필요</span> : '-'}</td>
                <td className="small">{formatKst(item.observedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="card-list" aria-label="매물 카드">
        {items.map((item) => (
          <li key={item.id} className="card">
            <div className="card-head">
              <Thumb listing={item} />
              <div>
                <strong>{item.title}</strong>
                <div className="muted small">{item.player ?? '선수 미상'}</div>
              </div>
            </div>
            <dl>
              <dt>등록 가격</dt>
              <dd>{formatUsd(item.askingPrice, item.currency)}</dd>
              <dt>상품+표시 배송비</dt>
              <dd>{displayTotal(item) ? formatUsd(displayTotal(item), item.currency) : '배송비 미상'}</dd>
              <dt>수집 시각</dt>
              <dd>{formatKst(item.observedAt)}</dd>
            </dl>
            {onOpen && (
              <button type="button" onClick={() => onOpen(item.id)}>
                상세 보기
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Thumb({ listing }: { listing: Listing }) {
  // 원격 이미지 실패 시 중립 플레이스홀더로 바꾼다. 이미지 바이너리는 저장하지 않는다.
  return listing.imageUrl ? (
    <img
      className="thumb"
      src={listing.imageUrl}
      alt=""
      loading="lazy"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = '/placeholder-card.svg';
      }}
    />
  ) : (
    <img className="thumb" src="/placeholder-card.svg" alt="이미지 없음" />
  );
}
