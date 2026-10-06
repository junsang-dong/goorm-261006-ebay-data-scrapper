export type SourceMode = 'mock' | 'live' | 'sandbox';
export type DetailStatus = 'not_requested' | 'pending' | 'complete' | 'failed';
export type Provenance = 'api_aspect' | 'api_condition' | 'title_rule' | 'manual';
export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'ending_soon';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';
export type ItemStatus = 'pending' | 'completed' | 'failed';

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
];

export interface SearchCriteria {
  q: string;
  minPrice?: string;
  maxPrice?: string;
  sort: SortKey;
  gradedOnly?: boolean;
}

export interface Listing {
  id: string;
  sourceMode: SourceMode;
  marketplaceId: string;
  ebayItemId: string;
  legacyItemId: string | null;
  title: string;
  itemUrl: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  conditionId: string | null;
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
  detailStatus: DetailStatus;
  observedAt: string;
  expiresAt: string;
}

export interface CollectionJob {
  id: string;
  idempotencyKey: string | null;
  status: JobStatus;
  sourceMode: SourceMode;
  criteria: SearchCriteria;
  maxItems: number;
  cursor: number;
  searchExhausted: boolean;
  discovered: number;
  searchCalls: number;
  detailCalls: number;
  savedCount: number;
  failedCount: number;
  leaseUntil: number | null;
  nextRetryAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobItem {
  jobId: string;
  ebayItemId: string;
  status: ItemStatus;
  listingId: string | null;
  errorCode: string | null;
}
