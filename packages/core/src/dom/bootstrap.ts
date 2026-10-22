import DEFAULT_SITE_RULES_JSON from '../rules/default-site-rules.json' with { type: 'json' };
import {
  isNewerRules,
  matchSite,
  validateSiteRules,
  type SiteRule,
  type SiteRulesDoc,
} from '../rules/schema.ts';
import type { TeamRef } from '../match/types.ts';
import { NOT_SCORE_DATA, scorePath } from '../match/score-file.ts';
import {
  DEFAULT_SHIELD_PREFS,
  keepRootClasses,
  SpoilerShield,
  type ShieldPrefs,
  type ShieldStats,
} from './shield.ts';
import { CLASS_READY } from './css.ts';

/** 插件和用户脚本共用的设置（插件存在 chrome.storage，用户脚本存在 GM 存储） */
export interface ShieldSettings {
  enabled: boolean;
  /** 在这些域名上停用 */
  disabledHosts: string[];
  prefs: ShieldPrefs;
  /** 全网防剧透：在设定时段对所有网站做通用文字识别 */
  global: { enabled: boolean; start: string; end: string; days: number[] };
  /** 远程下载并校验过的站点规则 */
  rules?: SiteRulesDoc;
  rulesCheckedAt?: number;
  /** 防剧透网页的数据地址（以 / 结尾），用于下载比分和规则 */
  dataBase: string;
  /** 已看（已显示比分）的比赛 */
  watched: Record<string, number>;
  /** 从网页跳转过来时正在看的比赛 */
  currentMatch?: CurrentMatch;
}

export interface CurrentMatch {
  id: string;
  title: string;
  competition: string;
  kickoff: string;
  home: TeamRef;
  away: TeamRef;
  url: string;
  host: string;
  at: number;
  liveMode?: boolean;
}

export function defaultShieldSettings(dataBase: string): ShieldSettings {
  return {
    enabled: true,
    disabledHosts: [],
    prefs: structuredClone(DEFAULT_SHIELD_PREFS),
    global: { enabled: false, start: '06:00', end: '12:00', days: [0, 1, 2, 3, 4, 5, 6] },
    dataBase,
    watched: {},
  };
}

export function normalizeSettings(
  raw: Partial<ShieldSettings> | null | undefined,
  dataBase: string,
): ShieldSettings {
  const base = defaultShieldSettings(dataBase);
  if (!raw || typeof raw !== 'object') return base;
  const stored = raw.rules ? validateSiteRules(raw.rules) : null;
  // 插件/脚本更新后内置规则可能比之前下载存下的更新：旧的存档不再使用（远程下载失败时也能用上新规则）
  const rules = stored && !isNewerRules(defaultRules().version, stored.version) ? stored : null;
  return {
    ...base,
    ...raw,
    prefs: {
      ...base.prefs,
      ...(raw.prefs ?? {}),
      hide: { ...base.prefs.hide, ...(raw.prefs?.hide ?? {}) },
    },
    global: { ...base.global, ...(raw.global ?? {}) },
    disabledHosts: Array.isArray(raw.disabledHosts)
      ? raw.disabledHosts.filter((h) => typeof h === 'string')
      : [],
    watched: raw.watched && typeof raw.watched === 'object' ? raw.watched : {},
    rules: rules ?? undefined,
    dataBase:
      typeof raw.dataBase === 'string' &&
      /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(raw.dataBase)
        ? raw.dataBase
        : dataBase,
  };
}

export const defaultRules = (): SiteRulesDoc => validateSiteRules(DEFAULT_SITE_RULES_JSON)!;

/** 网页发给插件/脚本的已看记录相关消息 */
export interface WebWatchedMessage {
  type?: string;
  watched?: unknown;
  /** hello：网页删掉过的已看记录（id → 删除时间，秒） */
  unwatched?: unknown;
  /** unwatch：刚刚删掉的已看记录 id */
  ids?: unknown;
}

const numberEntries = (v: unknown): [string, number][] =>
  v && typeof v === 'object'
    ? Object.entries(v as Record<string, unknown>).filter(
        (e): e is [string, number] => typeof e[1] === 'number',
      )
    : [];

/**
 * 插件/脚本收到网页的 hello / state / unwatch 后，算出新的已看记录：
 * - unwatch：删掉这些 id（网页上点了"藏起比分并标记为没看"或清空了数据）
 * - hello：先丢掉网页删除之前就有的记录（删除之后在别处重新看过的照常保留），再并入网页的记录
 * - state：并入网页的记录（只加不减）
 */
export function applyWebWatched(
  current: Record<string, number>,
  msg: WebWatchedMessage,
): { watched: Record<string, number>; changed: boolean } {
  let out = { ...current };
  let changed = false;
  if (msg.type === 'unwatch') {
    for (const id of Array.isArray(msg.ids) ? msg.ids : []) {
      if (typeof id === 'string' && id in out) {
        delete out[id];
        changed = true;
      }
    }
    return { watched: out, changed };
  }
  const removed = Object.fromEntries(msg.type === 'hello' ? numberEntries(msg.unwatched) : []);
  const keep = (id: string, t: number) => !(removed[id] !== undefined && t <= removed[id]);
  const before = Object.keys(out).length;
  out = Object.fromEntries(Object.entries(out).filter(([id, t]) => keep(id, t)));
  if (Object.keys(out).length !== before) changed = true;
  for (const [id, t] of numberEntries(msg.watched)) {
    if (!out[id] && keep(id, t)) {
      out[id] = t;
      changed = true;
    }
  }
  return { watched: out, changed };
}

/** 同一平台的域名（双向：www.miguvideo.com 与 m.miguvideo.com 互相匹配），用于"正在看的比赛" */
export function hostMatches(host: string, target: string): boolean {
  const h = host.toLowerCase();
  const t = target.toLowerCase().replace(/^www\./, '');
  return h === t || h.endsWith(`.${t}`) || t.endsWith(`.${h.replace(/^www\./, '')}`);
}

/**
 * 停用名单里的 target 是否覆盖当前域名（单向：只覆盖它自己和它的子域名）。
 * 在 live.bilibili.com 停用不能连带停用 www.bilibili.com。
 */
export function hostDisabledBy(host: string, target: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  const t = target.toLowerCase().replace(/^www\./, '');
  return h === t || h.endsWith(`.${t}`);
}

/** 从网页跳转过来 6 小时内、同一平台的页面，视为在看这场比赛 */
export function currentMatchFor(
  settings: ShieldSettings,
  hostname: string,
  now = Date.now(),
): CurrentMatch | null {
  const m = settings.currentMatch;
  if (!m || now - m.at > 6 * 60 * 60 * 1000) return null;
  return hostMatches(hostname, m.host) ? m : null;
}

/** 全网模式的时段判断（本地时间；支持跨午夜，例如 22:00–08:00） */
export function inSchedule(global: ShieldSettings['global'], now = new Date()): boolean {
  if (!global.enabled) return false;
  const toMin = (t: string) => {
    const [h = '0', m = '0'] = t.split(':');
    return Number(h) * 60 + Number(m);
  };
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = toMin(global.start);
  const end = toMin(global.end);
  const day = now.getDay();
  if (start === end) return global.days.includes(day);
  if (start < end) return global.days.includes(day) && minutes >= start && minutes < end;
  // 跨午夜：属于开始那天
  if (minutes >= start) return global.days.includes(day);
  return minutes < end && global.days.includes((day + 6) % 7);
}

/** 处理完已有内容后再显示页面；最多等 timeoutMs（期间 MutationObserver 一直在处理新内容） */
export function revealWhenReady(doc: Document, timeoutMs = 2500): void {
  const reveal = () => doc.documentElement?.classList.add(CLASS_READY);
  if (doc.readyState !== 'loading') {
    reveal();
    return;
  }
  doc.addEventListener('DOMContentLoaded', reveal, { once: true });
  setTimeout(reveal, timeoutMs);
}

export interface BootOptions {
  /** 当前域名有站点规则时为 true；全网模式注入时为 false */
  siteMode: boolean;
  onStats?: (stats: ShieldStats) => void;
}

export interface ShieldController {
  shield: SpoilerShield | null;
  site: SiteRule | null;
  active: boolean;
  reason?: string;
  currentMatch: CurrentMatch | null;
  /** 一键临时显示 */
  pause(ms?: number): void;
  resume(): void;
  update(settings: ShieldSettings): void;
}

/**
 * 根据设置启动遮挡；不需要工作时立即显示页面。
 * 返回的控制器会跟着设置走：之后调用 update() 时，关闭→开启、停用→启用都会自动重新启动；
 * 全网模式下每分钟看一次时段，时段开始就自动启动、结束就自动解除（页面可能一直开着跨过时段边界）
 */
export function bootShield(
  doc: Document,
  settings: ShieldSettings,
  options: BootOptions,
): ShieldController {
  let latest = settings;
  let inner = startShield(doc, latest, options);
  const host = doc.location?.hostname ?? '';
  const wanted = () =>
    latest.enabled &&
    !latest.disabledHosts.some((h) => hostDisabledBy(host, h)) &&
    (inner.site !== null || options.siteMode ? true : inSchedule(latest.global));
  /**
   * 时段结束后不再算「工作中」，但这个页面上已经遮住的内容保持到刷新（不突然把比分露出来）；
   * 之后新打开的页面不会启动，时段再开始时这里照常
   */
  let heldBySchedule = false;
  /** 总开关关了 / 此站点停用：遮挡由 inner.update 解除，状态也要对应 */
  const userDisabled = (): string | null =>
    !latest.enabled
      ? '已关闭'
      : latest.disabledHosts.some((h) => hostDisabledBy(host, h))
        ? '此站点已停用'
        : null;
  const sync = () => {
    if (!inner.active) {
      if (wanted()) inner = startShield(doc, latest, options);
      return;
    }
    if (!options.siteMode && !inner.site) heldBySchedule = !inSchedule(latest.global);
    inner.update(latest);
  };
  if (!options.siteMode) {
    // 全网模式：时段边界是按分钟定义的，每分钟检查一次就够
    const win = doc.defaultView ?? globalThis;
    win.setInterval(sync, 60 * 1000);
  }
  return {
    get shield() {
      return inner.shield;
    },
    get site() {
      return inner.site;
    },
    get active() {
      return inner.active && !heldBySchedule && !userDisabled();
    },
    get reason() {
      return userDisabled() ?? (heldBySchedule ? '不在全网防剧透时段' : inner.reason);
    },
    get currentMatch() {
      return inner.currentMatch;
    },
    pause: (ms) => inner.pause(ms),
    resume: () => inner.resume(),
    update(next) {
      latest = next;
      sync();
    },
  };
}

/** 按当前设置启动一次（不管后续变化） */
function startShield(
  doc: Document,
  settings: ShieldSettings,
  options: BootOptions,
): ShieldController {
  const host = doc.location?.hostname ?? '';
  const rules = settings.rules ?? defaultRules();
  const site = options.siteMode ? matchSite(rules, host) : null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const inactive = (reason: string): ShieldController => {
    doc.documentElement?.classList.add(CLASS_READY);
    // 页面改写 <html class> 时别让整页遮罩重新出现
    keepRootClasses(doc);
    return {
      shield: null,
      site,
      active: false,
      reason,
      currentMatch: null,
      pause() {},
      resume() {},
      update() {},
    };
  };

  if (!settings.enabled) return inactive('已关闭');
  if (settings.disabledHosts.some((h) => hostDisabledBy(host, h))) return inactive('此站点已停用');
  if (!site && !inSchedule(settings.global)) return inactive('不在全网防剧透时段');

  const currentMatch = currentMatchFor(settings, host);
  const shield = new SpoilerShield(doc, {
    site,
    extraWords: rules.extraWords,
    safePhrases: rules.safePhrases,
    prefs: settings.prefs,
    forceFootball: Boolean(currentMatch),
    onStats: options.onStats,
  });
  shield.start();
  revealWhenReady(doc);

  /** 用户点了"临时显示"、还没到时间 */
  let userPaused = false;
  /** 设置里关闭了插件或停用了此站点 */
  let disabled = false;
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    shield,
    site,
    active: true,
    currentMatch,
    pause(ms = 5 * 60 * 1000) {
      userPaused = true;
      shield.pause();
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        userPaused = false;
        if (!disabled) shield.resume();
      }, ms);
    },
    resume() {
      clearTimer();
      userPaused = false;
      if (!disabled) shield.resume();
    },
    update(next) {
      disabled = !next.enabled || next.disabledHosts.some((h) => hostDisabledBy(host, h));
      if (disabled) {
        // 停用后旧的"临时显示"计时器不能再把遮挡打开
        clearTimer();
        userPaused = false;
        shield.pause();
        return;
      }
      const nextRules = next.rules ?? defaultRules();
      shield.update({
        site: options.siteMode ? matchSite(nextRules, host) : null,
        prefs: next.prefs,
        extraWords: nextRules.extraWords,
        safePhrases: nextRules.safePhrases,
      });
      // 无关的设置写入（已看记录、规则检查时间等）不能提前结束用户的临时显示
      if (!userPaused) shield.resume();
    },
  };
}

/** 下载比分（插件弹窗和用户脚本面板用） */
export async function fetchScoreFrom(
  dataBase: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
) {
  const url = new URL(scorePath(id), dataBase).href;
  const res = await fetchImpl(url, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let data: ({ id?: string; home?: number; away?: number } & Record<string, unknown>) | null;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // 返回的是网页而不是 JSON：数据地址填错、运营商劫持、公共 Wi‑Fi 的登录页等，不能当成「还没有比分」
    throw new Error(NOT_SCORE_DATA);
  }
  return data && data.id === id && typeof data.home === 'number' ? data : null;
}

/** 下载远程规则并做格式校验（只是数据，不含代码）；要不要采用、版本是否更新由调用方判断 */
export async function fetchRemoteRules(
  dataBase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteRulesDoc | null> {
  const url = new URL('site-rules.json', dataBase).href;
  const res = await fetchImpl(url, { cache: 'no-cache' });
  if (!res.ok) return null;
  return validateSiteRules(await res.json());
}
