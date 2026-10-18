import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHttpFetcher, redactUrl } from '../src/http.ts';
import { isAllowedByRobots, parseRobots } from '../src/robots.ts';
import { offsetTimeToUtc, seasonOf, zonedToUtc } from '../src/time.ts';

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return handler(url, init);
  }) as typeof fetch;
  return { impl, calls };
}

describe('HTTP 层', () => {
  it('缓存：有效期内不重复请求；过期后带 ETag 条件请求', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sff-cache-'));
    const { impl, calls } = fakeFetch((_url, init) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      if (h['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
      return new Response('{"a":1}', { status: 200, headers: { etag: '"v1"' } });
    });
    const f = createHttpFetcher({
      cacheDir: dir,
      fetchImpl: impl,
      defaultIntervalMs: 0,
      sleep: async () => {},
    });
    expect(await f.getJson('https://api.example.com/x', { kind: 'api' })).toEqual({ a: 1 });
    expect(await f.getJson('https://api.example.com/x', { kind: 'api' })).toEqual({ a: 1 });
    expect(calls).toHaveLength(1);
    const res = await f.getText('https://api.example.com/x', { kind: 'api', ttlMs: 0 });
    expect(res.fromCache).toBe(true);
    expect(calls[1]!.headers['If-None-Match']).toBe('"v1"');
  });

  it('限速：同一域名两次请求之间等待', async () => {
    const waits: number[] = [];
    const { impl } = fakeFetch(() => new Response('{}'));
    const f = createHttpFetcher({
      fetchImpl: impl,
      minIntervalMs: { 'api.example.com': 6500 },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await f.getText('https://api.example.com/a', { kind: 'api' });
    await f.getText('https://api.example.com/b', { kind: 'api' });
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(6000);
  });

  it('429 时按 Retry-After 重试', async () => {
    let n = 0;
    const waits: number[] = [];
    const { impl } = fakeFetch(() =>
      n++ === 0
        ? new Response('', { status: 429, headers: { 'retry-after': '7' } })
        : new Response('ok'),
    );
    const f = createHttpFetcher({
      fetchImpl: impl,
      defaultIntervalMs: 0,
      sleep: async (ms) => void waits.push(ms),
    });
    expect((await f.getText('https://api.example.com/a', { kind: 'api' })).body).toBe('ok');
    expect(waits).toContain(7000);
  });

  it('网页抓取遵守 robots.txt', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow: /private/\n')
        : new Response('<html></html>'),
    );
    const f = createHttpFetcher({ fetchImpl: impl, defaultIntervalMs: 0, sleep: async () => {} });
    await expect(f.getText('https://site.example.com/private/a', { kind: 'page' })).rejects.toThrow(
      /robots/,
    );
    await f.getText('https://site.example.com/public/a', { kind: 'page' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://site.example.com/robots.txt',
      'https://site.example.com/public/a',
    ]);
  });

  it('日志里隐藏密钥', () => {
    expect(
      redactUrl('https://www.thesportsdb.com/api/v1/json/SECRETKEY/eventsround.php'),
    ).not.toContain('SECRETKEY');
    expect(redactUrl('https://x.com/a?apikey=abc&b=1')).toBe('https://x.com/a?apikey=***&b=1');
  });
});

describe('robots.txt 解析', () => {
  const rules = parseRobots(`
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /search
Allow: /search/about
Disallow: /*.json$
`);
  it('分组、最长匹配、通配', () => {
    expect(isAllowedByRobots(rules, '/video/BV1', 'SpoilerFreeFootball')).toBe(true);
    expect(isAllowedByRobots(rules, '/search?q=1', 'SpoilerFreeFootball')).toBe(false);
    expect(isAllowedByRobots(rules, '/search/about', 'SpoilerFreeFootball')).toBe(true);
    expect(isAllowedByRobots(rules, '/a/b.json', 'SpoilerFreeFootball')).toBe(false);
    expect(isAllowedByRobots(rules, '/anything', 'BadBot/1.0')).toBe(false);
  });
});

describe('时间工具', () => {
  it('当地时间 → UTC（含夏令时切换）', () => {
    expect(zonedToUtc('2026-10-17', '12:30', 'Europe/London')).toBe('2026-10-17T11:30:00.000Z');
    expect(zonedToUtc('2026-10-31', '15:00', 'Europe/London')).toBe('2026-10-31T15:00:00.000Z');
    expect(zonedToUtc('2026-10-24', '21:00', 'Europe/Madrid')).toBe('2026-10-24T19:00:00.000Z');
    expect(zonedToUtc('2026-11-01', '21:00', 'Europe/Madrid')).toBe('2026-11-01T20:00:00.000Z');
    expect(zonedToUtc('2026-10-19', '19:30', 'Asia/Shanghai')).toBe('2026-10-19T11:30:00.000Z');
  });
  it('"16:30 UTC-4" 写法', () => {
    expect(offsetTimeToUtc('2026-06-29', '16:30 UTC-4')).toBe('2026-06-29T20:30:00.000Z');
    expect(offsetTimeToUtc('2026-06-11', '13:00 UTC-6')).toBe('2026-06-11T19:00:00.000Z');
  });
  it('赛季', () => {
    expect(seasonOf(new Date('2026-10-16'))).toBe('2026-27');
    expect(seasonOf(new Date('2027-03-01'))).toBe('2026-27');
    expect(seasonOf(new Date('2027-07-15'))).toBe('2027-28');
  });
});

describe('请求超时', () => {
  it('卡住不返回的请求按超时处理：重试后仍超时就报错，有旧缓存时用旧缓存', async () => {
    const hang = (async (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const f = createHttpFetcher({
      fetchImpl: hang,
      defaultIntervalMs: 0,
      timeoutMs: 20,
      retries: 1,
      sleep: async () => {},
    });
    await expect(f.getText('https://api.example.com/slow', { kind: 'api' })).rejects.toThrow();

    const dir = await mkdtemp(join(tmpdir(), 'sff-http-'));
    let ok = true;
    const flaky = (async (url: string | URL, init?: RequestInit) =>
      ok ? new Response('fresh', { status: 200 }) : hang(url, init)) as typeof fetch;
    const g = createHttpFetcher({
      cacheDir: dir,
      fetchImpl: flaky,
      defaultIntervalMs: 0,
      timeoutMs: 20,
      retries: 0,
      sleep: async () => {},
    });
    expect((await g.getText('https://api.example.com/c', { kind: 'api' })).body).toBe('fresh');
    ok = false;
    const res = await g.getText('https://api.example.com/c', { kind: 'api', ttlMs: 0 });
    expect(res).toMatchObject({ body: 'fresh', fromCache: true });
  });
});
