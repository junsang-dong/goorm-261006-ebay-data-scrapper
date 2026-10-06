import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 브라우저 번들(src)은 서버 코드·비밀 환경변수를 가져오면 안 된다 (SPEC 11).
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('browser/server boundary', () => {
  const files = walk(join(process.cwd(), 'src')).filter((f) => /\.(ts|tsx)$/.test(f));

  it('does not import server modules from the frontend', () => {
    const offenders = files.filter((file) => /from\s+['"][^'"]*server\//.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('does not read secret environment variables in the frontend', () => {
    const secretNames = /(ADMIN_PASSWORD_HASH|SESSION_SECRET|CRON_SECRET|DATABASE_URL|EBAY_CLIENT_SECRET)/;
    const offenders = files.filter((file) => secretNames.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never uses dangerouslySetInnerHTML', () => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes('dangerouslySetInnerHTML'));
    expect(offenders).toEqual([]);
  });
});
