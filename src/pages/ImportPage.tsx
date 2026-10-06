import { useState, type ChangeEvent } from 'react';
import { analyzeImport, formatCents, type GroupStat, type ImportReport } from '../../shared/apify/analyze';
import { parseApifyDataset } from '../../shared/apify/parse';
import { WARNING_LABEL } from '../lib/format';

const CONDITION_LABEL: Record<string, string> = {
  graded: '등급 있음',
  raw: '미등급 (Ungraded)',
  used: '중고',
  new: '새 상품',
  other: '기타',
};

const FLAG_LABEL: Record<string, string> = { graded: '등급 있음', needs_review: '확인 필요', ...WARNING_LABEL };

export default function ImportPage() {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setReport(null);
    setFileName(file.name);
    try {
      // 파일은 브라우저 안에서만 읽는다. 서버로 보내거나 저장하지 않는다.
      const data: unknown = JSON.parse(await file.text());
      const parsed = parseApifyDataset(data);
      if (parsed.items.length === 0) {
        setError('분석할 매물이 없습니다. 파일 형식과 내용을 확인하세요.');
      } else {
        setReport(analyzeImport(parsed, new Date()));
      }
    } catch (err) {
      setError(err instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : err instanceof Error ? err.message : '파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  return (
    <section className="page">
      <h1>Apify 데이터 가져오기</h1>
      <p className="muted">
        Apify eBay 검색 결과 JSON을 올리면 이 브라우저 안에서 분석합니다. 파일은 서버로 전송되거나 저장되지 않습니다.
        eBay API 연결 여부와 관계없이 사용할 수 있습니다.
      </p>

      <div className="card">
        <label htmlFor="apify-file">JSON 파일 선택</label>
        <input id="apify-file" type="file" accept="application/json,.json" onChange={onFile} disabled={busy} />
        {fileName && <p className="small muted">파일: {fileName}{busy ? ' · 분석 중…' : ''}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      {report && <Report report={report} />}
    </section>
  );
}

function Report({ report }: { report: ImportReport }) {
  const stats = report.pricing.stats;
  return (
    <>
      <section className="card" aria-labelledby="r-totals">
        <h2 id="r-totals">요약</h2>
        <dl className="stats">
          <div><dt>전체 레코드</dt><dd>{report.records}</dd></div>
          <div><dt>분석 대상</dt><dd>{report.parsed}</dd></div>
          <div><dt>건너뜀</dt><dd>{report.skipped}</dd></div>
          <div><dt>단일 카드</dt><dd>{report.scope.singles}</dd></div>
          <div><dt>묶음(Lot)</dt><dd>{report.scope.lots}</dd></div>
          <div><dt>카드 외 카테고리</dt><dd>{report.scope.offTopic}</dd></div>
          <div><dt>고정가 가격 있음</dt><dd>{report.pricing.fixedSingles}</dd></div>
          <div><dt>경매(입찰만)</dt><dd>{report.pricing.auctionSingles}</dd></div>
        </dl>
        {report.freshness && (
          <p className={report.freshness.withinSixHours ? 'small muted' : 'error small'}>
            가장 오래된 관측: {report.freshness.oldestScrapedAt} ({report.freshness.ageHours}시간 전)
            {report.freshness.withinSixHours ? ' · 6시간 이내' : ' · 6시간 초과'}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="r-price">
        <h2 id="r-price">등록 가격 통계 (단일 카드, 고정가)</h2>
        {stats ? (
          <dl className="stats">
            <div><dt>최저</dt><dd>{formatCents(stats.minCents)}</dd></div>
            <div><dt>중앙값</dt><dd>{formatCents(stats.medianCents)}</dd></div>
            <div><dt>평균</dt><dd>{formatCents(stats.meanCents)}</dd></div>
            <div><dt>최고</dt><dd>{formatCents(stats.maxCents)}</dd></div>
          </dl>
        ) : (
          <p className="muted">고정가 단일 카드가 없습니다.</p>
        )}
        <p className="small muted">표본 {stats?.count ?? 0}건 · 가격 미확인 {report.pricing.unpricedSingles}건 · 등록 가격 기준 (세금·배송비 제외)</p>
      </section>

      <div className="split">
        <GroupTable title="상태별 중앙값" rows={report.pricing.byCondition.map((r) => ({ ...r, label: CONDITION_LABEL[r.label] ?? r.label }))} />
        <GroupTable title="인증 기관별 중앙값" rows={report.pricing.byGrader} />
      </div>
      <GroupTable title="판본 상위 10" rows={report.pricing.topParallels} />

      <section className="card" aria-labelledby="r-cov">
        <h2 id="r-cov">속성 충족률 (단일 카드 {report.scope.singles}건 기준)</h2>
        <table>
          <thead><tr><th scope="col">속성</th><th scope="col">채워진 건수</th><th scope="col">충족률</th></tr></thead>
          <tbody>
            {report.coverage.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{row.filled} / {row.total}</td>
                <td>
                  <div className="bar" aria-hidden="true"><span style={{ width: `${Math.round(row.rate * 100)}%` }} /></div>
                  <span className="small">{Math.round(row.rate * 100)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">누락률은 100% 에서 충족률을 뺀 값입니다. 제목 추정 값도 포함된 수치입니다.</p>
      </section>

      <section className="card" aria-labelledby="r-review">
        <h2 id="r-review">검토와 배송</h2>
        <dl className="kv">
          <dt>확인 필요 (단일 카드)</dt><dd>{report.review.needsReview}건</dd>
          <dt>묶음 후보 (전체)</dt><dd>{report.review.lotCandidates}건</dd>
          <dt>복각·레플리카 후보 (전체)</dt><dd>{report.review.reprintCandidates}건</dd>
          <dt>무료 배송 문구 있음</dt><dd>{report.shipping.free}건</dd>
          <dt>배송비 미상</dt><dd>{report.shipping.unknown}건</dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="r-cheap">
        <h2 id="r-cheap">가장 낮은 고정가 매물 10건</h2>
        {report.cheapest.length === 0 ? (
          <p className="muted">표시할 매물이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">등록 가격</th><th scope="col">제목</th><th scope="col">표시 사항</th><th scope="col">원문</th></tr></thead>
              <tbody>
                {report.cheapest.map((row) => (
                  <tr key={row.itemId}>
                    <td className="num">{formatCents(row.priceCents)}</td>
                    <td>{row.title}</td>
                    <td className="small">{row.flags.map((f) => FLAG_LABEL[f] ?? f).join(' · ') || '-'}</td>
                    <td>{row.url ? <a href={row.url} target="_blank" rel="noopener noreferrer">eBay에서 보기</a> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="r-notes">
        <h2 id="r-notes">분석 기준과 주의</h2>
        <ul>
          {report.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </section>
    </>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupStat[] }) {
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">데이터가 없습니다.</p>
      ) : (
        <table>
          <thead><tr><th scope="col">구분</th><th scope="col">건수</th><th scope="col">중앙값</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.count}</td>
                <td className="num">{formatCents(row.medianCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
