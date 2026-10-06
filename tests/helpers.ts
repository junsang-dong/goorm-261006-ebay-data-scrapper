import { loadConfig, type AppConfig } from '../server/config';
import { hashPassword } from '../server/auth/admin';
import { mockAdapter } from '../server/ebay/mock-adapter';
import type { ServiceContext } from '../server/services/context';
import { MemoryStore } from '../server/store/memory-store';

export const TEST_PASSWORD = 'correct horse battery';
export const TEST_SECRET = 'test-session-secret-0123456789';
export const TEST_CRON = 'cron-secret-for-tests';
export const TEST_HOST = 'localhost:5173';
export const TEST_ORIGIN = `http://${TEST_HOST}`;

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    DATA_MODE: 'mock',
    ADMIN_PASSWORD_HASH: hashPassword(TEST_PASSWORD, Buffer.alloc(16, 7)),
    SESSION_SECRET: TEST_SECRET,
    CRON_SECRET: TEST_CRON,
    ...overrides,
  });
}

export function makeCtx(overrides: Partial<ServiceContext> = {}): ServiceContext {
  return {
    store: new MemoryStore(),
    adapter: mockAdapter,
    sourceMode: 'mock',
    marketplaceId: 'EBAY_US',
    budgetLimit: null,
    ttlSeconds: 18000,
    now: new Date('2026-10-06T00:00:00Z'),
    ...overrides,
  };
}
