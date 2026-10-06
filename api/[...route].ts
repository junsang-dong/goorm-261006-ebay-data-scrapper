import type { VercelRequest, VercelResponse } from '@vercel/node';
import { dispatch } from '../server/http/dispatch';

// 모든 /api/* 요청을 하나의 진입점으로 받는다. 실제 라우팅은 server/http/dispatch.ts 에 있다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const segments = Array.isArray(req.query.route) ? req.query.route : [req.query.route ?? ''];
  const result = await dispatch({
    method: req.method ?? 'GET',
    route: segments.filter(Boolean),
    query: req.query as Record<string, string | string[] | undefined>,
    body: req.body,
    headers: req.headers as Record<string, string | string[] | undefined>,
  });
  for (const [key, value] of Object.entries(result.headers)) {
    res.setHeader(key, value);
  }
  res.status(result.status).json(result.body);
}
