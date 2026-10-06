import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../lib/api-client';

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword('');
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '로그인 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>관리자 로그인</h1>
        <p className="muted">단일 관리자 워크스페이스입니다. 여러 번 실패하면 잠시 잠깁니다.</p>
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy || password.length === 0}>
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
