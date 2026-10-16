import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAllowedByRobots, parseRobots, type RobotsRules } from './robots.ts';

export interface FetchOptions {
  headers?: Record<string, string>;
  /** 缓存有效期（毫秒）；过期后带 ETag 重新验证 */
  ttlMs?: number;
  /** API 接口（官方提供给程序调用的地址）不检查 robots.txt；网页抓取必须检查 */
  kind?: 'api' | 'page';
}

export interface FetchResult {
  status: number;
  body: string;
  fromCache: boolean;
}

export interface Fetcher {
  getText(url: string, options?: FetchOptions): Promise<FetchResult>;
  getJson<T = unknown>(url: string, options?: FetchOptions): Promise<T>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} ${redactUrl(url)}`);
  }
}

/** 日志里不打印 URL 中的密钥 */
export function redactUrl(url: string): string {
  return url
    .replace(/\/json\/[^/]{4,}\//, '/json/***/')
    .replace(/([?&](?:key|token|apikey)=)[^&]+/gi, '$1***');
}

export interface HttpFetcherConfig {
  cacheDir?: string;
  userAgent?: string;
  /** 每个域名两次请求的最小间隔 */
  minIntervalMs?: Record<string, number>;
  defaultIntervalMs?: number;
  retries?: number;
  log?: (msg: string) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry {
  url: string;
  status: number;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  body: string;
}

const DEFAULT_UA =
  'SpoilerFreeFootball/0.1 (+https://github.com/MessiXpro/spoiler-free-football; schedule aggregator, low-rate)';

/** 真实网络请求：本地缓存 + 条件请求 + 按域名限速 + robots.txt + 重试 */
export function createHttpFetcher(config: HttpFetcherConfig = {}): Fetcher {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const userAgent = config.userAgent ?? DEFAULT_UA;
  const lastRequestAt = new Map<string, number>();
  const robotsCache = new Map<string, RobotsRules | null>();
  const log = config.log ?? (() => {});

  const cachePath = (url: string) =>
    config.cacheDir
      ? join(config.cacheDir, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`)
      : null;

  async function readCache(url: string): Promise<CacheEntry | null> {
    const path = cachePath(url);
    if (!path) return null;
    try {
      return JSON.parse(await readFile(path, 'utf8')) as CacheEntry;
    } catch {
      return null;
    }
  }

  async function writeCache(entry: CacheEntry) {
    const path = cachePath(entry.url);
    if (!path || !config.cacheDir) return;
    await mkdir(config.cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify(entry));
  }

  async function throttle(host: string) {
    const interval = config.minIntervalMs?.[host] ?? config.defaultIntervalMs ?? 1000;
    const last = lastRequestAt.get(host) ?? 0;
    const wait = last + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, Date.now());
  }

  async function robotsFor(origin: string): Promise<RobotsRules | null> {
    if (robotsCache.has(origin)) return robotsCache.get(origin) ?? null;
    let rules: RobotsRules | null = null;
    try {
      const res = await fetchImpl(`${origin}/robots.txt`, { headers: { 'User-Agent': userAgent } });
      if (res.ok) rules = parseRobots(await res.text());
    } catch {
      rules = null;
    }
    robotsCache.set(origin, rules);
    return rules;
  }

  async function getText(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const ttl = options.ttlMs ?? 60 * 60 * 1000;
    const cached = await readCache(url);
    if (cached && Date.now() - cached.fetchedAt < ttl) {
      return { status: cached.status, body: cached.body, fromCache: true };
    }
    const u = new URL(url);
    if (options.kind === 'page') {
      const robots = await robotsFor(u.origin);
      if (robots && !isAllowedByRobots(robots, u.pathname + u.search, 'SpoilerFreeFootball')) {
        throw new HttpError(0, url, `robots.txt 不允许抓取 ${u.pathname}`);
      }
    }
    const headers: Record<string, string> = { 'User-Agent': userAgent, ...options.headers };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

    const retries = config.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      await throttle(u.host);
      let res: Response;
      try {
        res = await fetchImpl(url, { headers });
      } catch (err) {
        if (attempt < retries) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        if (cached) {
          log(`网络错误，使用旧缓存：${redactUrl(url)}`);
          return { status: cached.status, body: cached.body, fromCache: true };
        }
        throw err;
      }
      if (res.status === 304 && cached) {
        await writeCache({ ...cached, fetchedAt: Date.now() });
        return { status: cached.status, body: cached.body, fromCache: true };
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt,
        );
        continue;
      }
      const body = await res.text();
      if (!res.ok) throw new HttpError(res.status, url);
      await writeCache({
        url,
        status: res.status,
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        fetchedAt: Date.now(),
        body,
      });
      return { status: res.status, body, fromCache: false };
    }
  }

  return {
    getText,
    async getJson<T>(url: string, options?: FetchOptions) {
      const { body } = await getText(url, options);
      return JSON.parse(body) as T;
    },
  };
}

/**
 * 测试用：把 URL 映射到保存下来的真实响应文件。
 * routes 的 key 是 URL 里必须包含的片段，按顺序匹配第一个。
 */
export function createFixtureFetcher(
  routes: Array<[string | RegExp, string | (() => string)]>,
  onRequest?: (url: string) => void,
): Fetcher {
  async function getText(url: string): Promise<FetchResult> {
    onRequest?.(url);
    for (const [pattern, body] of routes) {
      const hit = typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url);
      if (hit)
        return { status: 200, body: typeof body === 'function' ? body() : body, fromCache: false };
    }
    throw new HttpError(404, url, `fixture 不存在：${url}`);
  }
  return {
    getText,
    async getJson<T>(url: string) {
      return JSON.parse((await getText(url)).body) as T;
    },
  };
}
