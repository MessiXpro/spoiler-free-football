import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index.ts';

function env(origins = ''): Env & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    ALLOWED_ORIGINS: origins,
    SYNC_KV: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => void store.set(k, v),
    },
  };
}

const KEY = 'abcdefghijklmnopqrstuv';
const req = (method: string, path: string, body?: string, origin = 'https://example.github.io') =>
  new Request(`https://sync.example.workers.dev${path}`, {
    method,
    body,
    headers: { Origin: origin },
  });

describe('同步服务', () => {
  it('上传后可以下载', async () => {
    const e = env();
    const state = JSON.stringify({ v: 1, teams: ['arsenal'], watched: { a: 1 } });
    expect((await worker.fetch(req('PUT', `/v1/state/${KEY}`, state), e)).status).toBe(200);
    const res = await worker.fetch(req('GET', `/v1/state/${KEY}`), e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(state));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('拒绝非法 key、非 JSON、版本不对、过大的内容', async () => {
    const e = env();
    expect((await worker.fetch(req('GET', '/v1/state/short'), e)).status).toBe(400);
    expect((await worker.fetch(req('PUT', `/v1/state/${KEY}`, 'not json'), e)).status).toBe(400);
    expect((await worker.fetch(req('PUT', `/v1/state/${KEY}`, '{"v":2}'), e)).status).toBe(400);
    const big = JSON.stringify({ v: 1, pad: 'x'.repeat(70 * 1024) });
    expect((await worker.fetch(req('PUT', `/v1/state/${KEY}`, big), e)).status).toBe(413);
    expect((await worker.fetch(req('GET', `/v1/state/${KEY}`), e)).status).toBe(404);
    expect((await worker.fetch(req('DELETE', `/v1/state/${KEY}`), e)).status).toBe(405);
    expect((await worker.fetch(req('GET', '/other'), e)).status).toBe(404);
  });

  it('CORS：预检与来源白名单', async () => {
    const e = env('https://messixpro.github.io');
    const pre = await worker.fetch(
      req('OPTIONS', `/v1/state/${KEY}`, undefined, 'https://messixpro.github.io'),
      e,
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('https://messixpro.github.io');
    const other = await worker.fetch(
      req('GET', `/v1/state/${KEY}`, undefined, 'https://evil.example'),
      e,
    );
    expect(other.headers.get('Access-Control-Allow-Origin')).toBe('https://messixpro.github.io');
  });
});
