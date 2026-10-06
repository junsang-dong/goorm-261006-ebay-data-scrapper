import type {
  ApiMeta,
  CollectionJob,
  Listing,
  ListingPage,
  SavedSearch,
  SearchCriteria,
  StatusData,
} from '../types/api';

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  data: T;
  meta?: ApiMeta;
  warnings?: string[];
}

export const AUTH_LOST_EVENT = 'auth-lost';

async function request<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code: string = json?.error?.code ?? `HTTP_${res.status}`;
    if (code === 'AUTH_REQUIRED') window.dispatchEvent(new Event(AUTH_LOST_EVENT));
    throw new ApiRequestError(
      code,
      json?.error?.message ?? '요청을 처리하지 못했습니다.',
      res.status,
      json?.error?.retryable ?? false,
    );
  }
  return json as Envelope<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  login: (password: string) => post<{ authenticated: boolean }>('/auth/login', { password }),
  logout: () => post<{ authenticated: boolean }>('/auth/logout'),
  status: () => request<StatusData>('/status'),
  connectionTest: () => post<unknown>('/ebay/connection-test'),
  search: (criteria: SearchCriteria, offset = 0, pageSize = 50) =>
    post<{ items: Listing[]; totalHint: number; nextOffset: number | null }>('/ebay/search', {
      criteria,
      offset,
      pageSize,
    }),
  listings: (params: URLSearchParams) => request<ListingPage>(`/listings?${params.toString()}`),
  listing: (id: string) => request<Listing>(`/listings/${encodeURIComponent(id)}`),
  refreshListing: (id: string) => post<Listing>(`/listings/${encodeURIComponent(id)}/refresh`),
  deleteListing: (id: string) =>
    request<{ deleted: boolean }>(`/listings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createJob: (criteria: SearchCriteria, maxItems: number) =>
    post<CollectionJob>('/collection-jobs', { criteria, maxItems, idempotencyKey: crypto.randomUUID() }),
  stepJob: (id: string) => post<{ job: CollectionJob; done: boolean }>(`/collection-jobs/${id}/step`),
  cancelJob: (id: string) => post<CollectionJob>(`/collection-jobs/${id}/cancel`),
  resumeJob: (id: string) => post<CollectionJob>(`/collection-jobs/${id}/resume`),
  savedSearches: () => request<SavedSearch[]>('/saved-searches'),
  createSavedSearch: (name: string, criteria: SearchCriteria) =>
    post<SavedSearch>('/saved-searches', { name, criteria }),
  deleteSavedSearch: (id: string) =>
    request<{ deleted: boolean }>(`/saved-searches?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportData: (format: 'csv' | 'json', filters: Record<string, string>) =>
    post<{ format: string; filename: string; rowCount: number; truncated: boolean; content: string }>(
      '/exports',
      { format, filters },
    ),
};

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
