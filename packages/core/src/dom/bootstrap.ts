import DEFAULT_SITE_RULES_JSON from '../rules/default-site-rules.json' with { type: 'json' };
import { matchSite, validateSiteRules, type SiteRule, type SiteRulesDoc } from '../rules/schema.ts';
import type { TeamRef } from '../match/types.ts';
import {
  DEFAULT_SHIELD_PREFS,
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
  const rules = raw.rules ? validateSiteRules(raw.rules) : null;
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

export function hostMatches(host: string, target: string): boolean {
  const h = host.toLowerCase();
  const t = target.toLowerCase().replace(/^www\./, '');
  return h === t || h.endsWith(`.${t}`) || t.endsWith(`.${h.replace(/^www\./, '')}`);
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

/** 根据设置启动遮挡；不需要工作时立即显示页面 */
export function bootShield(
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
  if (settings.disabledHosts.some((h) => hostMatches(host, h))) return inactive('此站点已停用');
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

  return {
    shield,
    site,
    active: true,
    currentMatch,
    pause(ms = 5 * 60 * 1000) {
      shield.pause();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => shield.resume(), ms);
    },
    resume() {
      if (timer) clearTimeout(timer);
      shield.resume();
    },
    update(next) {
      if (!next.enabled || next.disabledHosts.some((h) => hostMatches(host, h))) {
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
      shield.resume();
    },
  };
}

/** 下载比分（插件弹窗和用户脚本面板用） */
export async function fetchScoreFrom(
  dataBase: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
) {
  const url = new URL(`scores/${encodeURIComponent(id)}.json`, dataBase).href;
  const res = await fetchImpl(url, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try {
    const data = (await res.json()) as { id?: string; home?: number; away?: number } & Record<
      string,
      unknown
    >;
    return data && data.id === id && typeof data.home === 'number' ? data : null;
  } catch {
    return null;
  }
}

/** 下载远程规则并校验；只接受比当前更新的版本 */
export async function fetchRemoteRules(
  dataBase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteRulesDoc | null> {
  const url = new URL('site-rules.json', dataBase).href;
  const res = await fetchImpl(url, { cache: 'no-cache' });
  if (!res.ok) return null;
  return validateSiteRules(await res.json());
}
