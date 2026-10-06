import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import {
  clearLoginFailures,
  isLoginAllowed,
  isValidSession,
  parseCookie,
  recordLoginFailure,
  revokeSession,
  safeEqual,
  SESSION_COOKIE,
  issueSession,
  verifyPassword,
} from '../auth/admin';
import { loadConfig, type AppConfig } from '../config';
import { liveAdapter } from '../ebay/live-adapter';
import { mockAdapter } from '../ebay/mock-adapter';
import type { CatalogAdapter } from '../ebay/types';
import { ApiError, redact } from '../lib/errors';
import { assertExportAllowed, buildCsv, buildJson } from '../policies/exports';
import { purgeExpired } from '../policies/retention';
import { usedToday } from '../policies/budget';
import { cancelJob, createJob, getJobOrThrow, resumeJob, stepJob } from '../services/collections';

import type { ServiceContext } from '../services/context';
import {
  createSavedSearch,
  criteriaFromInput,
  deleteListing,
  deleteSavedSearch,
  getListing,
  listingFilterSchema,
  listListings,
  listSavedSearches,
  listSortSchema,
  previewSearch,
  refreshListing,
  searchCriteriaSchema,
} from '../services/listings';
import type { CollectionJob } from '../domain/types';
import { type MemoryStore, store as defaultStore } from '../store/memory-store';

export interface DispatchInput {
  method: string;
  route: string[];
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  store?: MemoryStore;
  config?: AppConfig;
  now?: Date;
}

export interface DispatchResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

interface HandlerContext {
  svc: ServiceContext;
  config: AppConfig;
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
}

interface HandlerResult {
  status?: number;
  data: unknown;
  warnings?: string[];
  headers?: Record<string, string>;
}

type Auth = 'session' | 'cron' | 'public';

interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  path: string[]; // ':name' 은 경로 파라미터
  auth: Auth;
  handler: (c: HandlerContext) => Promise<HandlerResult>;
}

const str = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// 내부 lease 시각 대신 실행 중 여부만 노출한다.
const jobView = (job: CollectionJob) => {
  const { leaseUntil, ...rest } = job;
  return { ...rest, leased: leaseUntil !== null };
};

const loginSchema = z.object({ password: z.string().min(1).max(200) });
const jobCreateSchema = z.object({
  criteria: searchCriteriaSchema.transform(criteriaFromInput),
  maxItems: z.number().int().min(1).max(200).default(50),
  idempotencyKey: z.string().max(100).optional(),
});
const savedSearchSchema = z.object({
  name: z.string().trim().min(1).max(60),
  criteria: searchCriteriaSchema.transform(criteriaFromInput),
});
const exportSchema = z.object({
  format: z.enum(['csv', 'json']),
  filters: listingFilterSchema.optional(),
});
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sort: listSortSchema,
});
const EXPORT_LIMIT = 1000;

const routes: Route[] = [
  {
    method: 'POST',
    path: ['auth', 'login'],
    auth: 'public',
    handler: async (c) => {
      const { password } = loginSchema.parse(c.body);
      const { store, now } = c.svc;
      if (!c.config.adminPasswordHash || !c.config.sessionSecret) {
        throw new ApiError('AUTH_NOT_CONFIGURED', '관리자 인증 환경변수가 설정되지 않았습니다.', 503);
      }
      const nowMs = now.getTime();
      if (!isLoginAllowed(store, c.ip, nowMs)) {
        throw new ApiError('LOGIN_LOCKED', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.', 429, true);
      }
      if (!verifyPassword(password, c.config.adminPasswordHash)) {
        recordLoginFailure(store, c.ip, nowMs);
        throw new ApiError('INVALID_CREDENTIALS', '비밀번호가 올바르지 않습니다.', 401);
      }
      clearLoginFailures(store, c.ip);
      const { cookieValue, maxAgeSec } = issueSession(store, c.config.sessionSecret, nowMs);
      return {
        data: { authenticated: true },
        headers: { 'Set-Cookie': sessionCookie(cookieValue, maxAgeSec) },
      };
    },
  },
  {
    method: 'POST',
    path: ['auth', 'logout'],
    auth: 'public',
    handler: async (c) => {
      revokeSession(c.svc.store, parseCookie(str(c.headers.cookie), SESSION_COOKIE));
      return { data: { authenticated: false }, headers: { 'Set-Cookie': sessionCookie('', 0) } };
    },
  },
  {
    method: 'GET',
    path: ['status'],
    auth: 'session',
    handler: async (c) => ({
      data: {
        dataMode: c.config.dataMode,
        sourceMode: c.svc.sourceMode,
        marketplaceId: c.config.marketplaceId,
        ebayConnection: c.config.dataMode === 'live' ? 'not_ready' : 'sample',
        features: { liveData: false, liveExport: c.config.enableLiveExport },
        budget: { limit: c.svc.budgetLimit, usedToday: usedToday(c.svc.store, c.svc.adapter.provider, c.svc.now) },
        cacheTtlSeconds: c.config.cacheTtlSeconds,
      },
    }),
  },
  {
    method: 'POST',
    path: ['ebay', 'connection-test'],
    auth: 'session',
    handler: async (c) => {
      if (c.svc.sourceMode === 'mock') {
        return { data: { token: { ok: true, note: '샘플 모드: 외부 호출 없음' }, search: { ok: true } } };
      }
      return {
        data: {
          token: { ok: false, code: 'EBAY_ACCESS_NOT_READY' },
          search: { ok: false, code: 'EBAY_ACCESS_NOT_READY' },
        },
      };
    },
  },
  {
    method: 'POST',
    path: ['ebay', 'search'],
    auth: 'session',
    handler: async (c) => {
      const body = z
        .object({ criteria: searchCriteriaSchema, offset: z.number().int().min(0).default(0), pageSize: z.number().int().min(1).max(100).default(50) })
        .parse(c.body);
      const result = await previewSearch(c.svc, body.criteria, body.offset, body.pageSize);
      return { data: { items: result.items, totalHint: result.totalHint, nextOffset: result.nextOffset }, warnings: result.warnings };
    },
  },
  {
    method: 'GET',
    path: ['listings'],
    auth: 'session',
    handler: async (c) => {
      const page = paginationSchema.parse(c.query);
      const filters = listingFilterSchema.parse(c.query);
      return { data: listListings(c.svc, filters, page.sort, page.page, page.pageSize) };
    },
  },
  {
    method: 'GET',
    path: ['listings', ':id'],
    auth: 'session',
    handler: async (c) => ({ data: getListing(c.svc, c.params.id) }),
  },
  {
    method: 'POST',
    path: ['listings', ':id', 'refresh'],
    auth: 'session',
    handler: async (c) => ({ data: await refreshListing(c.svc, c.params.id) }),
  },
  {
    method: 'DELETE',
    path: ['listings', ':id'],
    auth: 'session',
    handler: async (c) => {
      deleteListing(c.svc, c.params.id);
      return { data: { deleted: true } };
    },
  },
  {
    method: 'POST',
    path: ['collection-jobs'],
    auth: 'session',
    handler: async (c) => {
      const body = jobCreateSchema.parse(c.body);
      const idempotencyKey = body.idempotencyKey ?? str(c.headers['idempotency-key']);
      const job = createJob(c.svc, { criteria: body.criteria, maxItems: body.maxItems, idempotencyKey });
      return { status: 201, data: jobView(job) };
    },
  },
  {
    method: 'GET',
    path: ['collection-jobs', ':id'],
    auth: 'session',
    handler: async (c) => ({ data: jobView(getJobOrThrow(c.svc, c.params.id)) }),
  },
  {
    method: 'POST',
    path: ['collection-jobs', ':id', 'step'],
    auth: 'session',
    handler: async (c) => {
      const { job, done } = await stepJob(c.svc, c.params.id);
      return { data: { job: jobView(job), done } };
    },
  },
  {
    method: 'POST',
    path: ['collection-jobs', ':id', 'cancel'],
    auth: 'session',
    handler: async (c) => ({ data: jobView(cancelJob(c.svc, c.params.id)) }),
  },
  {
    method: 'POST',
    path: ['collection-jobs', ':id', 'resume'],
    auth: 'session',
    handler: async (c) => ({ data: jobView(resumeJob(c.svc, c.params.id)) }),
  },
  {
    method: 'GET',
    path: ['saved-searches'],
    auth: 'session',
    handler: async (c) => ({ data: listSavedSearches(c.svc) }),
  },
  {
    method: 'POST',
    path: ['saved-searches'],
    auth: 'session',
    handler: async (c) => {
      const body = savedSearchSchema.parse(c.body);
      return { status: 201, data: createSavedSearch(c.svc, body.name, body.criteria) };
    },
  },
  {
    method: 'DELETE',
    path: ['saved-searches'],
    auth: 'session',
    handler: async (c) => {
      const id = z.string().uuid().parse(str(c.query.id));
      deleteSavedSearch(c.svc, id);
      return { data: { deleted: true } };
    },
  },
  {
    method: 'POST',
    path: ['exports'],
    auth: 'session',
    handler: async (c) => {
      const body = exportSchema.parse(c.body);
      assertExportAllowed(c.svc.sourceMode, c.config.enableLiveExport);
      const { items, total } = listListings(c.svc, body.filters ?? {}, 'observed_desc', 1, EXPORT_LIMIT);
      const content = body.format === 'csv' ? buildCsv(items) : buildJson(items);
      const stamp = c.svc.now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
      return {
        data: {
          format: body.format,
          filename: `cards-${c.svc.sourceMode}-${stamp}.${body.format}`,
          rowCount: items.length,
          truncated: total > EXPORT_LIMIT,
          content,
        },
      };
    },
  },
  {
    method: 'GET',
    path: ['maintenance', 'purge'],
    auth: 'cron',
    handler: async (c) => ({ data: purgeExpired(c.svc.store, c.svc.now) }),
  },
  {
    method: 'POST',
    path: ['maintenance', 'purge'],
    auth: 'cron',
    handler: async (c) => ({ data: purgeExpired(c.svc.store, c.svc.now) }),
  },
];

function sessionCookie(value: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function matchRoute(method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method || route.path.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = route.path.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
        return true;
      }
      return part === segments[i];
    });
    if (ok) return { route, params };
  }
  return null;
}

function sameOrigin(headers: DispatchInput['headers']): boolean {
  const origin = str(headers.origin);
  const host = str(headers.host);
  return Boolean(origin && host && (origin === `https://${host}` || origin === `http://${host}`));
}

function clientIp(headers: DispatchInput['headers']): string {
  return (str(headers['x-forwarded-for']) ?? '').split(',')[0].trim() || 'unknown';
}

function buildServiceContext(config: AppConfig, store: MemoryStore, now: Date): ServiceContext {
  const live = config.dataMode === 'live';
  const adapter: CatalogAdapter = live ? liveAdapter : mockAdapter;
  return {
    store,
    adapter,
    sourceMode: live ? 'live' : 'mock',
    marketplaceId: config.marketplaceId,
    budgetLimit: live ? config.dailyBudget : null,
    ttlSeconds: config.cacheTtlSeconds,
    now,
  };
}

function errorResult(status: number, code: string, message: string, retryable: boolean, requestId: string): DispatchResult {
  return { status, body: { error: { code, message, retryable }, requestId }, headers: {} };
}

// Vercel 함수(api/[...route].ts)와 테스트가 함께 쓰는 진입점.
export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const requestId = randomUUID();
  const config = input.config ?? loadConfig();
  const store = input.store ?? defaultStore;
  const now = input.now ?? new Date();
  const svc = buildServiceContext(config, store, now);

  try {
    const matched = matchRoute(input.method, input.route);
    if (!matched) {
      return errorResult(404, 'NOT_FOUND', '지원하지 않는 API 경로입니다.', false, requestId);
    }
    const { route, params } = matched;

    if (route.auth !== 'cron' && input.method !== 'GET' && !sameOrigin(input.headers)) {
      throw new ApiError('CSRF_REJECTED', '허용되지 않은 요청 출처입니다.', 403);
    }

    if (route.auth === 'session') {
      const cookie = parseCookie(str(input.headers.cookie), SESSION_COOKIE);
      if (!config.sessionSecret || !isValidSession(store, cookie, config.sessionSecret, now.getTime())) {
        throw new ApiError('AUTH_REQUIRED', '관리자 로그인이 필요합니다.', 401);
      }
    }
    if (route.auth === 'cron') {
      const header = str(input.headers.authorization) ?? '';
      if (!config.cronSecret) throw new ApiError('CRON_NOT_CONFIGURED', 'CRON_SECRET이 설정되지 않았습니다.', 503);
      if (!safeEqual(header, `Bearer ${config.cronSecret}`)) {
        throw new ApiError('AUTH_REQUIRED', '인증이 필요합니다.', 401);
      }
    }

    const result = await route.handler({
      svc,
      config,
      params,
      query: input.query,
      body: input.body ?? {},
      headers: input.headers,
      ip: clientIp(input.headers),
    });

    return {
      status: result.status ?? 200,
      headers: result.headers ?? {},
      body: {
        data: result.data,
        meta: { sourceMode: svc.sourceMode, observedAt: now.toISOString(), requestId },
        warnings: result.warnings ?? [],
      },
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResult(error.status, error.code, error.message, error.retryable, requestId);
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
      return errorResult(400, 'VALIDATION_ERROR', message, false, requestId);
    }
    console.error(redact(`[${requestId}] ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
    return errorResult(500, 'INTERNAL_ERROR', '서버 오류가 발생했습니다.', true, requestId);
  }
}
