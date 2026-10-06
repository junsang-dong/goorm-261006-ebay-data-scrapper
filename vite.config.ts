/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dispatch } from './server/http/dispatch';

const LOCAL_PORT = 5181;

// 로컬 개발용 /api 서버. 배포의 api/[...route].ts 와 같은 dispatch 를 호출하므로 동작이 같다.
// .env.local 의 서버 비밀값은 여기서만 process.env 로 읽는다 (브라우저로 나가지 않음).
function localApi(env: Record<string, string>): Plugin {
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server) {
      Object.assign(process.env, env);
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const url = new URL(req.url, 'http://localhost');
          const route = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
          const query = Object.fromEntries(url.searchParams.entries());
          const body = await readJson(req);
          const result = await dispatch({
            method: req.method ?? 'GET',
            route,
            query,
            body,
            headers: req.headers as Record<string, string | string[] | undefined>,
          });
          for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(result.body));
        } catch (error) {
          console.error('[local-api]', error instanceof Error ? error.message : error);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { code: 'BAD_REQUEST', message: '요청 본문을 읽을 수 없습니다.', retryable: false } }));
        }
      });
    },
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localApi(loadEnv(mode, process.cwd(), ''))],
  server: { port: LOCAL_PORT, strictPort: true, host: 'localhost' },
  preview: { port: LOCAL_PORT, strictPort: true, host: 'localhost' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
