import { useEffect, useState, type ReactNode } from 'react';
import { api, AUTH_LOST_EVENT } from './lib/api-client';
import { SOURCE_LABEL } from './lib/format';
import type { SourceMode, StatusData } from './types/api';
import LoginPage from './pages/LoginPage';
import SearchPage from './pages/SearchPage';
import ListingsPage from './pages/ListingsPage';
import ListingDetailPage from './pages/ListingDetailPage';
import SettingsPage from './pages/SettingsPage';
import ImportPage from './pages/ImportPage';

type AuthState = 'checking' | 'out' | 'in';

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/search';
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const onChange = () => setHash(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const [path, query = ''] = hash.split('?');
  return { path, params: new URLSearchParams(query) };
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [status, setStatus] = useState<StatusData | null>(null);
  const route = useHashRoute();

  useEffect(() => {
    api
      .status()
      .then((res) => {
        setStatus(res.data);
        setAuth('in');
      })
      .catch(() => setAuth('out'));
    const onLost = () => setAuth('out');
    window.addEventListener(AUTH_LOST_EVENT, onLost);
    return () => window.removeEventListener(AUTH_LOST_EVENT, onLost);
  }, []);

  if (auth === 'checking') return <div className="boot">불러오는 중…</div>;
  if (auth === 'out') {
    return (
      <LoginPage
        onLoggedIn={() => {
          api.status().then((res) => setStatus(res.data));
          setAuth('in');
        }}
      />
    );
  }

  const sourceMode: SourceMode = status?.sourceMode ?? 'mock';
  const isSample = sourceMode === 'mock';
  const nav = [
    { href: '#/search', label: '검색·수집', key: 'search' },
    { href: '#/listings', label: '저장 데이터', key: 'listings' },
    { href: '#/import', label: 'Apify 가져오기', key: 'import' },
    { href: '#/settings', label: '설정', key: 'settings' },
  ];
  const activeKey = route.path.startsWith('/listings')
    ? 'listings'
    : route.path.startsWith('/settings')
      ? 'settings'
      : route.path.startsWith('/import')
        ? 'import'
        : 'search';

  async function logout() {
    await api.logout().catch(() => undefined);
    setAuth('out');
  }

  let page: ReactNode;
  if (route.path.startsWith('/listings/')) {
    page = <ListingDetailPage id={route.path.slice('/listings/'.length)} />;
  } else if (route.path === '/listings') {
    page = <ListingsPage sourceMode={sourceMode} />;
  } else if (route.path === '/import') {
    page = <ImportPage />;
  } else if (route.path === '/settings') {
    page = <SettingsPage status={status} onStatusChange={setStatus} />;
  } else {
    page = <SearchPage sourceMode={sourceMode} initial={route.params} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">스포츠 카드 데이터 컬렉터</span>
          <span className={`mode-badge ${isSample ? 'mode-sample' : 'mode-live'}`} aria-label="데이터 출처">
            {SOURCE_LABEL[sourceMode]}
          </span>
        </div>
        <nav aria-label="주요 메뉴">
          {nav.map((item) => (
            <a key={item.key} href={item.href} className={activeKey === item.key ? 'active' : undefined} aria-current={activeKey === item.key ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <button type="button" className="ghost" onClick={logout}>
          로그아웃
        </button>
      </header>
      <p className="price-notice">등록 가격 기준 · 판매 완료 이력 미포함</p>
      {isSample && (
        <p className="sample-banner" role="note">
          현재 화면은 독립 제작 샘플 데이터입니다. eBay 실시간 결과가 아닙니다.
        </p>
      )}
      <main id="main">{page}</main>
      <footer className="footer">
        Developed by Jun · NextPlatform | React · Vite · TypeScript · Vercel / Built with Codex · SPEC with ChatGPT | Version 1.0.0 · © 2026
      </footer>
    </div>
  );
}
