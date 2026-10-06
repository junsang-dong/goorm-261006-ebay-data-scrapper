import { useEffect, useState } from 'react';
import ListingTable from '../components/ListingTable';
import { api, ApiRequestError, downloadText } from '../lib/api-client';
import { SOURCE_LABEL } from '../lib/format';
import type { ListingPage as ListingPageData, SourceMode } from '../types/api';

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  grader: string;
  graded: string;
  matchStatus: string;
  minPrice: string;
  maxPrice: string;
  sort: string;
}

const EMPTY_FILTERS: Filters = { q: '', grader: '', graded: '', matchStatus: '', minPrice: '', maxPrice: '', sort: 'observed_desc' };

export default function ListingsPage({ sourceMode }: { sourceMode: SourceMode }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListingPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    setLoading(true);
    api
      .listings(params)
      .then((res) => {
        setData(res.data);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : '목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [filters, page]);

  function update<K extends keyof Filters>(key: K, value: string) {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function onExport(format: 'csv' | 'json') {
    setNotice(null);
    try {
      const exportFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const res = await api.exportData(format, exportFilters);
      const mime = format === 'csv' ? 'text/csv' : 'application/json';
      downloadText(res.data.filename, res.data.content, mime);
      setNotice(`${res.data.rowCount}건을 내보냈습니다.${res.data.truncated ? ' (최대 1,000건까지만 포함)' : ''}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '내보내기에 실패했습니다.');
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section className="page">
      <h1>저장 데이터</h1>
      <p className="muted">
        {SOURCE_LABEL[sourceMode]} 중 표시 기간이 남은 매물만 보입니다. 만료된 매물은 목록에서 제외됩니다.
      </p>

      <form className="card filter-form" aria-label="저장 데이터 필터" onSubmit={(e) => e.preventDefault()}>
        <div className="field wide">
          <label htmlFor="f-q">제목·선수 검색</label>
          <input id="f-q" value={filters.q} onChange={(e) => update('q', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-grader">인증 기관</label>
          <select id="f-grader" value={filters.grader} onChange={(e) => update('grader', e.target.value)}>
            <option value="">전체</option>
            {['PSA', 'BGS', 'SGC', 'CGC'].map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-graded">매물 상태</label>
          <select id="f-graded" value={filters.graded} onChange={(e) => update('graded', e.target.value)}>
            <option value="">전체</option>
            <option value="true">등급 있음</option>
            <option value="false">미등급</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-match">검토 상태</label>
          <select id="f-match" value={filters.matchStatus} onChange={(e) => update('matchStatus', e.target.value)}>
            <option value="">전체</option>
            <option value="needs_review">확인 필요</option>
            <option value="ok">확인 완료 후보</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-min">최소 가격</label>
          <input id="f-min" inputMode="decimal" value={filters.minPrice} onChange={(e) => update('minPrice', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-max">최대 가격</label>
          <input id="f-max" inputMode="decimal" value={filters.maxPrice} onChange={(e) => update('maxPrice', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-sort">정렬</label>
          <select id="f-sort" value={filters.sort} onChange={(e) => update('sort', e.target.value)}>
            <option value="observed_desc">최근 수집순</option>
            <option value="price_asc">가격 낮은순</option>
            <option value="price_desc">가격 높은순</option>
            <option value="title_asc">제목순</option>
          </select>
        </div>
        <div className="actions wide">
          <button type="button" onClick={() => onExport('csv')}>CSV 내보내기</button>
          <button type="button" onClick={() => onExport('json')}>JSON 내보내기</button>
          <button type="button" className="ghost" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
            필터 초기화
          </button>
        </div>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {loading && <p className="muted">불러오는 중…</p>}

      {data && (
        <>
          <p className="muted small">총 {data.total}건 (표시 기간 내)</p>
          <ListingTable items={data.items} onOpen={(id) => (window.location.hash = `#/listings/${id}`)} />
          <nav className="pager" aria-label="페이지 이동">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
            <span>{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
          </nav>
        </>
      )}
    </section>
  );
}
