import { useEffect, useRef, useState, type FormEvent } from 'react';
import ListingTable from '../components/ListingTable';
import { api, ApiRequestError } from '../lib/api-client';
import { JOB_STATUS_LABEL } from '../lib/format';
import type { CollectionJob, Listing, SearchCriteria, SortKey, SourceMode } from '../types/api';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: '관련도순' },
  { value: 'price_asc', label: '가격 낮은순' },
  { value: 'price_desc', label: '가격 높은순' },
  { value: 'newest', label: '신규 등록순' },
  { value: 'ending_soon', label: '종료 임박순' },
];

const PRICE_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

interface Props {
  sourceMode: SourceMode;
  initial: URLSearchParams;
}

export default function SearchPage({ sourceMode, initial }: Props) {
  const [q, setQ] = useState(initial.get('q') ?? '');
  const [minPrice, setMinPrice] = useState(initial.get('min') ?? '');
  const [maxPrice, setMaxPrice] = useState(initial.get('max') ?? '');
  const [sort, setSort] = useState<SortKey>((initial.get('sort') as SortKey) ?? 'relevance');
  const [maxItems, setMaxItems] = useState(50);
  const [saveName, setSaveName] = useState('');
  const [items, setItems] = useState<Listing[] | null>(null);
  const [totalHint, setTotalHint] = useState<number | null>(null);
  const [job, setJob] = useState<CollectionJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  // 화면을 떠나면 단계 호출을 멈춘다. 서버 작업은 lease 만료 후 재개할 수 있다.
  useEffect(
    () => () => {
      runningRef.current = false;
    },
    [],
  );

  function stopRunning() {
    runningRef.current = false;
    setRunning(false);
  }

  function criteriaFrom(): SearchCriteria | null {
    const trimmed = q.trim();
    if (trimmed.length < 2 || trimmed.length > 200) {
      setError('검색어는 2~200자로 입력하세요.');
      return null;
    }
    if (minPrice && !PRICE_PATTERN.test(minPrice)) return fail('최소 가격 형식이 올바르지 않습니다.');
    if (maxPrice && !PRICE_PATTERN.test(maxPrice)) return fail('최대 가격 형식이 올바르지 않습니다.');
    if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) return fail('최소 가격은 최대 가격보다 클 수 없습니다.');
    setError(null);
    return { q: trimmed, minPrice: minPrice || undefined, maxPrice: maxPrice || undefined, sort };

    function fail(text: string) {
      setError(text);
      return null;
    }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const criteria = criteriaFrom();
    if (!criteria) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.search(criteria);
      setItems(res.data.items);
      setTotalHint(res.data.totalHint);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    const criteria = criteriaFrom();
    if (!criteria) return;
    const name = saveName.trim() || criteria.q;
    try {
      await api.createSavedSearch(name, criteria);
      setSaveName('');
      setMessage(`검색 조건 “${name}”을(를) 저장했습니다.`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function runJob(jobId: string) {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      while (runningRef.current) {
        const res = await api.stepJob(jobId);
        setJob(res.data.job);
        if (res.data.done || res.data.job.status === 'paused') break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      stopRunning();
    }
  }

  async function onCollect() {
    const criteria = criteriaFrom();
    if (!criteria) return;
    if (maxItems < 1 || maxItems > 200) {
      setError('수집 건수는 1~200건 사이로 지정하세요.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.createJob(criteria, maxItems);
      setJob(res.data);
      void runJob(res.data.id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!job) return;
    stopRunning();
    const res = await api.cancelJob(job.id).catch((err: unknown) => {
      setError(messageOf(err));
      return null;
    });
    if (res) setJob(res.data);
  }

  async function onResume() {
    if (!job) return;
    try {
      const res = await api.resumeJob(job.id);
      setJob(res.data);
      void runJob(job.id);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  const sampleNotice = sourceMode === 'mock' ? '샘플 데이터 기준' : '실데이터 기준';

  return (
    <section className="page">
      <h1>검색·수집</h1>
      <p className="muted">{sampleNotice}으로 매물을 찾고, 선택한 건수만 저장합니다. 제목 검색은 정확한 판본을 보장하지 않습니다.</p>

      <form className="card search-form" onSubmit={onSearch} aria-label="매물 검색">
        <div className="field wide">
          <label htmlFor="q">검색어</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: Mateo Okafor Halcyon Chrome 2024" maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="min">최소 가격 (USD)</label>
          <input id="min" inputMode="decimal" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="max">최대 가격 (USD)</label>
          <input id="max" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sort">정렬</label>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="actions wide">
          <button type="submit" className="primary" disabled={busy}>
            매물 검색
          </button>
          <label className="inline" htmlFor="maxItems">
            수집 건수
            <input id="maxItems" type="number" min={1} max={200} value={maxItems} onChange={(e) => setMaxItems(Number(e.target.value))} />
          </label>
          <button type="button" onClick={onCollect} disabled={busy || running}>
            이 조건으로 수집
          </button>
          <input aria-label="저장 이름" placeholder="저장 이름 (선택)" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          <button type="button" className="ghost" onClick={onSave}>
            검색 조건 저장
          </button>
        </div>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p className="success" role="status">{message}</p>}

      {job && <JobPanel job={job} running={running} onCancel={onCancel} onResume={onResume} />}

      {items && (
        <section aria-labelledby="results-heading">
          <h2 id="results-heading">검색 결과 미리보기</h2>
          <p className="muted small">
            검색 결과 참고치: {totalHint ?? 0}건 · 이 목록은 저장되지 않습니다. 저장하려면 수집을 실행하세요.
          </p>
          <ListingTable items={items} />
        </section>
      )}
    </section>
  );
}

function JobPanel({
  job,
  running,
  onCancel,
  onResume,
}: {
  job: CollectionJob;
  running: boolean;
  onCancel: () => void;
  onResume: () => void;
}) {
  const active = job.status === 'running' || job.status === 'queued';
  return (
    <section className="card job-panel" aria-labelledby="job-heading">
      <h2 id="job-heading">수집 작업</h2>
      <p>
        상태: <strong>{JOB_STATUS_LABEL[job.status] ?? job.status}</strong>
        {running && ' · 진행 중'}
        {job.errorCode && <span className="muted"> · 사유: {job.errorCode}</span>}
      </p>
      <dl className="stats">
        <div><dt>실제 확보 건수</dt><dd>{job.savedCount} / {job.maxItems}</dd></div>
        <div><dt>검색 호출</dt><dd>{job.searchCalls}</dd></div>
        <div><dt>상세 호출</dt><dd>{job.detailCalls}</dd></div>
        <div><dt>실패 건수</dt><dd>{job.failedCount}</dd></div>
      </dl>
      <div className="actions">
        {active && (
          <button type="button" onClick={onCancel}>
            중단
          </button>
        )}
        {job.status === 'paused' && (
          <button type="button" className="primary" onClick={onResume}>
            재개
          </button>
        )}
      </div>
    </section>
  );
}

function messageOf(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : '요청 처리 중 오류가 발생했습니다.';
}
