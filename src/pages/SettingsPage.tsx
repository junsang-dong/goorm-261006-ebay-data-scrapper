import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../lib/api-client';
import type { SavedSearch, StatusData } from '../types/api';

interface Props {
  status: StatusData | null;
  onStatusChange: (status: StatusData) => void;
}

export default function SettingsPage({ status, onStatusChange }: Props) {
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [diag, setDiag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.savedSearches().then((res) => setSaved(res.data)).catch(() => setError('저장된 검색 조건을 불러오지 못했습니다.'));
  }, []);

  async function runDiagnostics() {
    setDiag(null);
    try {
      await api.connectionTest();
      setDiag('진단을 완료했습니다. 샘플 모드에서는 외부 호출을 하지 않습니다.');
      const fresh = await api.status();
      onStatusChange(fresh.data);
    } catch (err) {
      setDiag(err instanceof ApiRequestError ? err.message : '진단에 실패했습니다.');
    }
  }

  async function removeSaved(id: string) {
    try {
      await api.deleteSavedSearch(id);
      setSaved((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '삭제에 실패했습니다.');
    }
  }

  return (
    <section className="page">
      <h1>설정</h1>

      <section className="card" aria-labelledby="conn-heading">
        <h2 id="conn-heading">API 연결 상태</h2>
        {status ? (
          <dl className="kv">
            <dt>데이터 모드</dt>
            <dd>{status.dataMode === 'mock' ? '샘플 (DATA_MODE=mock)' : '실데이터 (DATA_MODE=live)'}</dd>
            <dt>eBay 연결</dt>
            <dd>{status.ebayConnection === 'sample' ? '해당 없음 (샘플)' : '운영 접근 승인 전'}</dd>
            <dt>마켓플레이스</dt>
            <dd>{status.marketplaceId}</dd>
            <dt>오늘 앱 내부 호출</dt>
            <dd>{status.budget.usedToday} / {status.budget.limit ?? '제한 없음 (샘플)'}</dd>
            <dt>표시 캐시 기간</dt>
            <dd>{Math.round(status.cacheTtlSeconds / 3600 * 10) / 10}시간</dd>
            <dt>실데이터 내보내기</dt>
            <dd>{status.features.liveExport ? '허용' : '기본 비활성화 (403)'}</dd>
          </dl>
        ) : (
          <p className="muted">상태를 불러오는 중…</p>
        )}
        <div className="actions">
          <button type="button" onClick={runDiagnostics}>연결 진단 실행</button>
        </div>
        {diag && <p role="status" className="small">{diag}</p>}
        <p className="small muted">
          운영 실데이터는 eBay 개발자 계정의 Production 키와 Browse API 운영 접근 승인이 끝난 뒤에만 켭니다.
          키 생성만으로 승인이 완료되지 않습니다.
        </p>
      </section>

      <section className="card" aria-labelledby="saved-heading">
        <h2 id="saved-heading">저장된 검색 조건</h2>
        {error && <p className="error" role="alert">{error}</p>}
        {saved.length === 0 ? (
          <p className="muted">저장된 조건이 없습니다. 검색·수집 화면에서 저장할 수 있습니다.</p>
        ) : (
          <ul className="saved-list">
            {saved.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <div className="muted small">{s.criteria.q} · {s.criteria.sort}</div>
                </div>
                <div className="actions">
                  <a className="button-link" href={`#/search?q=${encodeURIComponent(s.criteria.q)}${s.criteria.minPrice ? `&min=${s.criteria.minPrice}` : ''}${s.criteria.maxPrice ? `&max=${s.criteria.maxPrice}` : ''}&sort=${s.criteria.sort}`}>
                    다시 검색
                  </a>
                  <button type="button" className="danger" onClick={() => removeSaved(s.id)}>삭제</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">자동 정기 수집은 이 버전 범위에 없습니다. 저장 조건은 수동으로 다시 실행합니다.</p>
      </section>
    </section>
  );
}
