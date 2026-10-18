import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Listener = (event: { waitUntil: (p: Promise<unknown>) => void }) => void;

/** 在沙箱里运行 service worker 模板，记录安装时预缓存了哪些请求 */
async function install(precache: string[]) {
  const source = readFileSync(join(__dirname, '..', 'src', 'sw-template.js'), 'utf8')
    .replace('__SFF_VERSION__', 'test')
    .replace('__SFF_PRECACHE__', JSON.stringify(precache));
  const listeners: Record<string, Listener> = {};
  const added: Array<{ url: string; cache: string }> = [];
  class FakeRequest {
    url: string;
    cache: string;
    constructor(url: string, init?: { cache?: string }) {
      this.url = url;
      this.cache = init?.cache ?? 'default';
    }
  }
  const swGlobal = {
    location: { origin: 'https://example.github.io' },
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const caches = {
    open: async () => ({
      addAll: async (reqs: Array<string | FakeRequest>) => {
        for (const r of reqs)
          added.push(typeof r === 'string' ? { url: r, cache: 'default' } : { ...r });
      },
    }),
    keys: async () => [],
  };
  runInNewContext(source, { self: swGlobal, caches, Request: FakeRequest, URL, fetch: () => {} });
  let done: Promise<unknown> = Promise.resolve();
  listeners.install!({ waitUntil: (p) => (done = p) });
  await done;
  return added;
}

describe('service worker 预缓存', () => {
  it('绕过浏览器 HTTP 缓存，避免把旧的 index.html 存进新版本缓存', async () => {
    const added = await install(['./', 'index.html', 'assets/index-NEW.js']);
    expect(added.map((r) => r.url)).toEqual(['./', 'index.html', 'assets/index-NEW.js']);
    for (const r of added) expect(r.cache).toBe('reload');
  });
});
