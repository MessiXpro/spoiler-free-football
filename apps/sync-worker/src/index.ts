/**
 * 可选的同步服务：用一个随机 key 存一份用户状态（订阅 + 已看记录）。
 *   PUT /v1/state/<key>   body: JSON（最大 64KB）
 *   GET /v1/state/<key>
 * key 由网页随机生成（相当于密码），服务端不需要账号。数据 180 天不访问自动过期。
 */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  SYNC_KV: KvLike;
  ALLOWED_ORIGINS?: string;
}

const MAX_BYTES = 64 * 1024;
const TTL_SECONDS = 180 * 24 * 60 * 60;
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

function cors(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = !allowed.length ? '*' : origin && allowed.includes(origin) ? origin : allowed[0]!;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(env, request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const m = url.pathname.match(/^\/v1\/state\/([^/]+)$/);
    if (!m) return json({ error: 'not found' }, 404, headers);
    const key = decodeURIComponent(m[1]!);
    if (!KEY_RE.test(key)) return json({ error: 'bad key' }, 400, headers);
    const kvKey = `state:${key}`;

    if (request.method === 'GET') {
      const value = await env.SYNC_KV.get(kvKey);
      if (!value) return json({ error: 'not found' }, 404, headers);
      // 读一次就续期
      await env.SYNC_KV.put(kvKey, value, { expirationTtl: TTL_SECONDS });
      return new Response(value, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...headers,
        },
      });
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BYTES)
        return json({ error: 'too large' }, 413, headers);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return json({ error: 'invalid json' }, 400, headers);
      }
      if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== 1) {
        return json({ error: 'unsupported' }, 400, headers);
      }
      await env.SYNC_KV.put(kvKey, JSON.stringify(parsed), { expirationTtl: TTL_SECONDS });
      return json({ ok: true }, 200, headers);
    }

    return json({ error: 'method not allowed' }, 405, headers);
  },
};
