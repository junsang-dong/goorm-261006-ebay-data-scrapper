import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { MemoryStore } from '../store/memory-store';

export const SESSION_COOKIE = 'sc_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// 저장 형식: scrypt$<salt base64>$<hash base64>
export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function isLoginAllowed(store: MemoryStore, ip: string, now: number): boolean {
  const entry = store.loginFailures.get(ip);
  if (!entry || entry.resetAt <= now) return true;
  return entry.count < LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(store: MemoryStore, ip: string, now: number): void {
  const entry = store.loginFailures.get(ip);
  if (!entry || entry.resetAt <= now) {
    store.loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count++;
  }
}

export function clearLoginFailures(store: MemoryStore, ip: string): void {
  store.loginFailures.delete(ip);
}

// 쿠키 값: <세션ID>.<HMAC>. 서버에는 세션ID의 해시와 만료 시각만 저장한다.
export function issueSession(store: MemoryStore, secret: string, now: number): { cookieValue: string; maxAgeSec: number } {
  const id = randomBytes(32).toString('base64url');
  const signature = createHmac('sha256', secret).update(id).digest('base64url');
  store.sessions.set(sha256(id), now + SESSION_TTL_MS);
  return { cookieValue: `${id}.${signature}`, maxAgeSec: SESSION_TTL_MS / 1000 };
}

export function isValidSession(store: MemoryStore, cookieValue: string | undefined, secret: string, now: number): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return false;
  const id = cookieValue.slice(0, dot);
  const expected = createHmac('sha256', secret).update(id).digest('base64url');
  const given = cookieValue.slice(dot + 1);
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return false;
  const expiresAt = store.sessions.get(sha256(id));
  return expiresAt !== undefined && expiresAt > now;
}

export function revokeSession(store: MemoryStore, cookieValue: string | undefined): void {
  if (!cookieValue) return;
  const dot = cookieValue.lastIndexOf('.');
  if (dot > 0) store.sessions.delete(sha256(cookieValue.slice(0, dot)));
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
