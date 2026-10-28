import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAllowedByRobots, parseRobots, type RobotsRules } from './robots.ts';

export interface FetchOptions {
  headers?: Record<string, string>;
  /**
   * 缓存有效期（毫秒）；过期后带 ETag 重新验证。
   * 也可以是函数：按缓存里的内容决定（例如已经踢完的轮次可以缓存更久）
   */
  ttlMs?: number | ((cachedBody: string) => number);
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
  /** 单次请求（含读取响应内容）的超时，默认 30 秒；卡住的连接不能拖住整个数据管线 */
  timeoutMs?: number;
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
// TheSportsDB 被限流时要求等 120 秒：不等够就重试一定还是 429，白白多等一次。最多等 3 分钟
const MAX_RETRY_WAIT_MS = 180_000;
const MIN_SLOWED_INTERVAL_MS = 5_000;
const MAX_SLOWED_INTERVAL_MS = 20_000;
/** 放慢之后连续这么多次请求没再被限流，就把间隔减半，一路减回原来的间隔 */
const RECOVER_AFTER_OK = 4;
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
  /** 被限流（429）之后放慢的请求间隔；之后一直没再被限流就逐步恢复 */
  const slowedInterval = new Map<string, number>();
  /** 放慢之后连续没被限流的请求数 */
  const okStreak = new Map<string, number>();
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

  /**
   * 被限流后把这个域名的请求间隔翻倍（至少 5 秒，最多 20 秒）。免费 Key 往往和很多人共用，
   * 实际额度比文档写的低，与其一直撞限流再长时间等待，不如主动放慢。
   * 限流常常只持续一两分钟（共用 Key 被别人用满了）：之后连续几次没再被限流就把间隔减半（见 recover），
   * 不然一次限流会让整次运行都按最慢的速度走，用完时间上限、后面的赛事都拉不到
   */
  function slowDown(host: string, retryAfterSec: number) {
    okStreak.set(host, 0);
    const current =
      slowedInterval.get(host) ?? config.minIntervalMs?.[host] ?? config.defaultIntervalMs ?? 1000;
    const next = Math.min(MAX_SLOWED_INTERVAL_MS, Math.max(MIN_SLOWED_INTERVAL_MS, current * 2));
    if (next === slowedInterval.get(host)) return;
    slowedInterval.set(host, next);
    // 服务器要求等的秒数也写进日志：限流窗口到底多长，看日志就知道（不然只看得到两次各等了 60 秒）
    const retryAfter = retryAfterSec > 0 ? `，Retry-After ${retryAfterSec} 秒` : '';
    log(`${host} 限流（HTTP 429${retryAfter}），之后每次请求间隔 ${Math.round(next / 1000)} 秒`);
  }

  function recover(host: string) {
    const slowed = slowedInterval.get(host);
    if (slowed === undefined) return;
    const n = (okStreak.get(host) ?? 0) + 1;
    if (n < RECOVER_AFTER_OK) {
      okStreak.set(host, n);
      return;
    }
    okStreak.set(host, 0);
    const next = Math.floor(slowed / 2);
    // 不能比这个域名原本的间隔还短（football-data 原本 6.5 秒：缩到 5 秒就超过每分钟 10 次的额度）
    const base = config.minIntervalMs?.[host] ?? config.defaultIntervalMs ?? 1000;
    if (next < Math.max(MIN_SLOWED_INTERVAL_MS, base)) {
      slowedInterval.delete(host);
      log(`${host} 没再限流，请求间隔恢复正常`);
    } else {
      slowedInterval.set(host, next);
      log(`${host} 没再限流，请求间隔缩短到 ${Math.round(next / 1000)} 秒`);
    }
  }

  async function throttle(host: string) {
    const interval =
      slowedInterval.get(host) ?? config.minIntervalMs?.[host] ?? config.defaultIntervalMs ?? 1000;
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
      const res = await fetchImpl(`${origin}/robots.txt`, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
      });
      if (res.ok) rules = parseRobots(await res.text());
    } catch {
      rules = null;
    }
    robotsCache.set(origin, rules);
    return rules;
  }

  async function getText(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    await sweepLegacyCache();
    const cached = await readCache(url);
    const ttl = !cached
      ? 0
      : typeof options.ttlMs === 'function'
        ? options.ttlMs(cached.body)
        : (options.ttlMs ?? 60 * 60 * 1000);
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
    const timeoutMs = config.timeoutMs ?? 30_000;
    for (let attempt = 0; ; attempt++) {
      await throttle(u.host);
      let res: Response;
      let body: string;
      try {
        // 超时同时覆盖连接和读取响应内容
        const signal = AbortSignal.timeout(timeoutMs);
        res = await fetchImpl(url, { headers, signal });
        body = res.status === 304 ? '' : await res.text();
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
      const retryAfter = Number(res.headers.get('retry-after'));
      if (res.status === 429) slowDown(u.host, retryAfter);
      else recover(u.host);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        // Retry-After 可能很长（比如一小时）：最多等 3 分钟，再不行就用旧缓存或报错
        await sleep(
          Math.min(
            MAX_RETRY_WAIT_MS,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt,
          ),
        );
        continue;
      }
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
