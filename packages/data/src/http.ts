import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAllowedByRobots, parseRobots, type RobotsRules } from './robots.ts';

export interface FetchOptions {
  headers?: Record<string, string>;
  /** 缓存有效期（毫秒）；过期后带 ETag 重新验证 */
  ttlMs?: number;
  /** API 接口（官方提供给程序调用的地址）不检查 robots.txt；网页抓取必须检查 */
  kind?: 'api' | 'page';
  /**
   * 返回 false 表示这是数据源用 HTTP 200 返回的报错（额度用完、Key 无效等）：
   * 不写缓存（否则之后几次运行都会重放这个错误）；有旧缓存时改用旧缓存
   */
  cacheable?: (body: string) => boolean;
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
  /** 去掉密钥后的 URL（缓存目录会被 GitHub Actions 缓存保存下来，不能带密钥） */
  url: string;
  status: number;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  body: string;
}

/**
 * 缓存文件名：v2- + 去掉密钥后的 URL 的哈希。
 * 旧版（没有前缀）用带密钥的完整 URL 算文件名、文件里也存了完整 URL，启动时清掉。
 */
const CACHE_PREFIX = 'v2-';
const LEGACY_CACHE_FILE = /^[0-9a-f]{32}\.json$/;

const isJson = (body: string) => {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
};

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
      ? join(
          config.cacheDir,
          `${CACHE_PREFIX}${createHash('sha256').update(redactUrl(url)).digest('hex').slice(0, 32)}.json`,
        )
      : null;

  let legacySwept = false;
  /** 删掉旧版缓存文件（里面有明文 TheSportsDB Key）；只删符合旧文件名格式的 */
  async function sweepLegacyCache() {
    if (legacySwept || !config.cacheDir) return;
    legacySwept = true;
    const dir = config.cacheDir;
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((n) => LEGACY_CACHE_FILE.test(n))
        .map((n) => rm(join(dir, n), { force: true }).catch(() => {})),
    );
  }

  async function readCache(url: string): Promise<CacheEntry | null> {
    const path = cachePath(url);
    if (!path) return null;
    try {
      return JSON.parse(await readFile(path, 'utf8')) as CacheEntry;
    } catch {
      return null;
    }
  }

  async function writeCache(url: string, entry: Omit<CacheEntry, 'url'>) {
    const path = cachePath(url);
    if (!path || !config.cacheDir) return;
    await mkdir(config.cacheDir, { recursive: true });
    // 文件里只存去掉密钥的 URL
    await writeFile(path, JSON.stringify({ ...entry, url: redactUrl(url) }));
  }

  async function throttle(host: string) {
    const interval = config.minIntervalMs?.[host] ?? config.defaultIntervalMs ?? 1000;
    const now = Date.now();
    const prev = lastRequestAt.get(host);
    const at = prev === undefined ? now : Math.max(now, prev + interval);
    // 先占好发出时间再等待：并发的请求（Promise.all）不会读到同一个"上次请求时间"而一起发出
    lastRequestAt.set(host, at);
    if (at > now) await sleep(at - now);
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
    await sweepLegacyCache();
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
        await writeCache(url, { ...cached, fetchedAt: Date.now() });
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
      // 重试后仍是 429/5xx：跟网络错误一样用旧缓存，不让整个数据源在这次部署里消失
      if ((res.status === 429 || res.status >= 500) && cached) {
        log(`HTTP ${res.status}，使用旧缓存：${redactUrl(url)}`);
        return { status: cached.status, body: cached.body, fromCache: true };
      }
      if (!res.ok) throw new HttpError(res.status, url);
      if (options.cacheable && !options.cacheable(body)) {
        if (cached) {
          log(`数据源返回报错内容，使用旧缓存：${redactUrl(url)}`);
          return { status: cached.status, body: cached.body, fromCache: true };
        }
        return { status: res.status, body, fromCache: false };
      }
      await writeCache(url, {
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
    async getJson<T>(url: string, options: FetchOptions = {}) {
      const { body } = await getText(url, {
        ...options,
        // 不是合法 JSON 的响应（被截断、错误页）也不缓存
        cacheable: (b) => isJson(b) && (options.cacheable?.(b) ?? true),
      });
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
