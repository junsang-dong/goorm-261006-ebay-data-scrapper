// 서버 응답 형태의 클라이언트용 타입. 서버 코드를 가져오지 않고 여기에 따로 둔다.
export type SourceMode = 'mock' | 'live' | 'sandbox';
export type Provenance = 'api_aspect' | 'api_condition' | 'title_rule' | 'manual';
export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'ending_soon';
export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface Listing {
  id: string;
  sourceMode: SourceMode;
  ebayItemId: string;
  title: string;
  itemUrl: string | null;
  imageUrl: string | null;
  conditionLabel: string | null;
  buyingOptions: string[];
  askingPrice: string;
  currency: string;
  shippingCost: string | null;
  shippingCurrency: string | null;
  locationCountry: string | null;
  sport: string | null;
  player: string | null;
  team: string | null;
  manufacturer: string | null;
  setName: string | null;
  cardNumber: string | null;
  seasonYear: string | null;
  parallelVariant: string | null;
  language: string | null;
  graded: boolean | null;
  grader: string | null;
  grade: string | null;
  certificationNumber: string | null;
  isLot: boolean;
  isReprint: boolean;
  matchStatus: 'ok' | 'needs_review';
  fieldProvenance: Record<string, Provenance>;
  normalizationWarnings: string[];
  detailStatus: string;
  observedAt: string;
  expiresAt: string;
}

export interface CollectionJob {
  id: string;
  status: JobStatus;
  criteria: SearchCriteria;
  maxItems: number;
  searchExhausted: boolean;
  discovered: number;
  searchCalls: number;
  detailCalls: number;
  savedCount: number;
  failedCount: number;
  leased: boolean;
  nextRetryAt: string | null;
  errorCode: string | null;
}

export interface SearchCriteria {
  q: string;
  minPrice?: string;
  maxPrice?: string;
  sort: SortKey;
  gradedOnly?: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
  criteria: SearchCriteria;
  createdAt: string;
}

export interface ListingPage {
  items: Listing[];
  page: number;
  pageSize: number;
  total: number;
}

export interface StatusData {
  dataMode: 'mock' | 'live';
  sourceMode: SourceMode;
  marketplaceId: string;
  ebayConnection: string;
  features: { liveData: boolean; liveExport: boolean };
  budget: { limit: number | null; usedToday: number };
  cacheTtlSeconds: number;
}

export interface ApiMeta {
  sourceMode: SourceMode;
  observedAt: string;
  requestId: string;
}
