export type DataMode = 'mock' | 'live';

export interface AppConfig {
  dataMode: DataMode;
  marketplaceId: string;
  dailyBudget: number;
  cacheTtlSeconds: number;
  enableLiveExport: boolean;
  adminPasswordHash: string | null;
  sessionSecret: string | null;
  cronSecret: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const ttl = Number(env.LIVE_CACHE_TTL_SECONDS ?? 18000);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error('LIVE_CACHE_TTL_SECONDS must be a positive integer');
  }
  const budget = Number(env.EBAY_DAILY_BUDGET ?? 500);
  if (!Number.isInteger(budget) || budget < 0) {
    throw new Error('EBAY_DAILY_BUDGET must be a non-negative integer');
  }
  return {
    dataMode: env.DATA_MODE === 'live' ? 'live' : 'mock',
    marketplaceId: env.EBAY_MARKETPLACE_ID ?? 'EBAY_US',
    dailyBudget: budget,
    cacheTtlSeconds: ttl,
    enableLiveExport: env.ENABLE_LIVE_EXPORT === 'true',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || null,
    sessionSecret: env.SESSION_SECRET || null,
    cronSecret: env.CRON_SECRET || null,
  };
}
