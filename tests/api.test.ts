import { describe, expect, it } from 'vitest';
import { dispatch } from '../server/http/dispatch';
import { MemoryStore } from '../server/store/memory-store';
import { TEST_CRON, TEST_HOST, TEST_ORIGIN, TEST_PASSWORD, testConfig } from './helpers';

function setup() {
  return { store: new MemoryStore(), config: testConfig(), now: new Date('2026-10-06T00:00:00Z') };
}

const originHeaders = { host: TEST_HOST, origin: TEST_ORIGIN };

async function login(env: ReturnType<typeof setup>): Promise<string> {
  const res = await dispatch({
    method: 'POST',
    route: ['auth', 'login'],
    query: {},
    body: { password: TEST_PASSWORD },
    headers: { ...originHeaders },
    ...env,
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers['Set-Cookie'];
  const value = /sc_session=([^;]+)/.exec(setCookie)?.[1];
  if (!value) throw new Error('no session cookie');
  return `sc_session=${value}`;
}

describe('admin authentication', () => {
  it('rejects data calls without a session', async () => {
    const env = setup();
    const res = await dispatch({ method: 'GET', route: ['listings'], query: {}, body: undefined, headers: {}, ...env });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });

  it('rejects a wrong password with the same generic error', async () => {
    const env = setup();
    const res = await dispatch({
      method: 'POST',
      route: ['auth', 'login'],
      query: {},
      body: { password: 'not the password' },
      headers: { ...originHeaders },
      ...env,
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('locks login after repeated failures from one IP', async () => {
    const env = setup();
    for (let i = 0; i < 5; i++) {
      await dispatch({
        method: 'POST',
        route: ['auth', 'login'],
        query: {},
        body: { password: 'wrong wrong wrong' },
        headers: { ...originHeaders, 'x-forwarded-for': '203.0.113.9' },
        ...env,
      });
    }
    const res = await dispatch({
      method: 'POST',
      route: ['auth', 'login'],
      query: {},
      body: { password: TEST_PASSWORD },
      headers: { ...originHeaders, 'x-forwarded-for': '203.0.113.9' },
      ...env,
    });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: { code: 'LOGIN_LOCKED' } });
  });

  it('blocks state-changing requests from another origin (CSRF)', async () => {
    const env = setup();
    const cookie = await login(env);
    const res = await dispatch({
      method: 'POST',
      route: ['collection-jobs'],
      query: {},
      body: { criteria: { q: 'Halcyon', sort: 'relevance' }, maxItems: 5 },
      headers: { cookie, host: TEST_HOST, origin: 'https://evil.example' },
      ...env,
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'CSRF_REJECTED' } });
  });

  it('keeps the logout cookie-clearing response', async () => {
    const env = setup();
    const cookie = await login(env);
    const out = await dispatch({ method: 'POST', route: ['auth', 'logout'], query: {}, body: {}, headers: { cookie, ...originHeaders }, ...env });
    expect(out.status).toBe(200);
    const after = await dispatch({ method: 'GET', route: ['status'], query: {}, body: undefined, headers: { cookie }, ...env });
    expect(after.status).toBe(401);
  });
});

describe('sample workflow through the API', () => {
  it('searches, collects, lists and exports without any secret key', async () => {
    const env = setup();
    const cookie = await login(env);
    const auth = { cookie, ...originHeaders };

    const status = await dispatch({ method: 'GET', route: ['status'], query: {}, body: undefined, headers: auth, ...env });
    expect(status.body).toMatchObject({ data: { sourceMode: 'mock', ebayConnection: 'sample' } });

    const search = await dispatch({
      method: 'POST',
      route: ['ebay', 'search'],
      query: {},
      body: { criteria: { q: 'Halcyon', sort: 'relevance' } },
      headers: auth,
      ...env,
    });
    expect(search.status).toBe(200);

    const created = await dispatch({
      method: 'POST',
      route: ['collection-jobs'],
      query: {},
      body: { criteria: { q: 'Halcyon', sort: 'relevance' }, maxItems: 10 },
      headers: { ...auth, 'idempotency-key': 'api-test-1' },
      ...env,
    });
    expect(created.status).toBe(201);
    const jobId = (created.body as { data: { id: string } }).data.id;

    let done = false;
    for (let i = 0; i < 50 && !done; i++) {
      const step = await dispatch({ method: 'POST', route: ['collection-jobs', jobId, 'step'], query: {}, body: {}, headers: auth, ...env });
      done = (step.body as { data: { done: boolean } }).data.done;
    }
    expect(done).toBe(true);

    const list = await dispatch({ method: 'GET', route: ['listings'], query: { pageSize: '50' }, body: undefined, headers: auth, ...env });
    expect(list.status).toBe(200);
    expect((list.body as { data: { total: number } }).data.total).toBeGreaterThan(0);

    const exported = await dispatch({
      method: 'POST',
      route: ['exports'],
      query: {},
      body: { format: 'csv' },
      headers: auth,
      ...env,
    });
    expect(exported.status).toBe(200);
    expect((exported.body as { data: { content: string } }).data.content.startsWith('﻿')).toBe(true);
  });

  it('blocks the purge endpoint without the cron secret', async () => {
    const env = setup();
    const denied = await dispatch({ method: 'GET', route: ['maintenance', 'purge'], query: {}, body: undefined, headers: {}, ...env });
    expect(denied.status).toBe(401);
    const allowed = await dispatch({
      method: 'GET',
      route: ['maintenance', 'purge'],
      query: {},
      body: undefined,
      headers: { authorization: `Bearer ${TEST_CRON}` },
      ...env,
    });
    expect(allowed.status).toBe(200);
  });

  it('returns a validation error for a bad price range', async () => {
    const env = setup();
    const cookie = await login(env);
    const res = await dispatch({
      method: 'POST',
      route: ['ebay', 'search'],
      query: {},
      body: { criteria: { q: 'Halcyon', minPrice: '50', maxPrice: '10' } },
      headers: { cookie, ...originHeaders },
      ...env,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
