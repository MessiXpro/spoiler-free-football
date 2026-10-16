import { COMPETITIONS, DEFAULT_TEAMS } from './catalog/index.ts';
import { beijingDate, isKnockoutStage, liveStatus, stageOrder } from './match/format.ts';
import type { Program, PublicMatch } from './match/types.ts';

/** off：不显示；teams：只显示订阅球队的比赛；all：显示全部比赛 */
export type CompetitionMode = 'off' | 'teams' | 'all';

export interface Settings {
  /** 淘汰赛对阵：前一轮订阅比赛没看完时隐藏队名 */
  lockKnockoutOpponents: boolean;
  /** 内嵌播放器底部加遮挡条（盖住时长和进度条） */
  embedMask: boolean;
  /** "即将开始"显示几天 */
  upcomingDays: number;
  /** 可选的同步服务器地址（Cloudflare Worker），留空表示不用 */
  syncEndpoint?: string;
  /** 同步服务器上的存储 key（随机生成，相当于密码；随同步码一起带到其他设备） */
  syncKey?: string;
}

export interface UserState {
  v: 1;
  /** 订阅的球队 id */
  teams: string[];
  /** 只保存和默认值不同的赛事设置 */
  competitions: Record<string, CompetitionMode>;
  /** 已看完（已显示比分）的比赛：id → 时间戳（秒） */
  watched: Record<string, number>;
  /** 手动解锁过的淘汰赛对阵 / 节目：key → 时间戳（秒） */
  unlocked: Record<string, number>;
  settings: Settings;
  /** 最近修改时间（毫秒），合并同步数据时用 */
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  lockKnockoutOpponents: true,
  embedMask: true,
  upcomingDays: 7,
};

export function defaultCompetitionMode(_competitionId: string): CompetitionMode {
  return 'teams';
}

export function defaultUserState(now = Date.now()): UserState {
  return {
    v: 1,
    teams: [...DEFAULT_TEAMS],
    competitions: {},
    watched: {},
    unlocked: {},
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: now,
  };
}

/** 读入可能来自旧版本/外部的数据，补全缺失字段、丢弃非法值 */
export function sanitizeUserState(input: unknown): UserState {
  const base = defaultUserState(0);
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<UserState>;
  const strArray = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length < 80) : null;
  const numRecord = (v: unknown) => {
    const out: Record<string, number> = {};
    if (v && typeof v === 'object') {
      for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
        if (typeof n === 'number' && Number.isFinite(n) && k.length < 160) out[k] = n;
      }
    }
    return out;
  };
  const comps: Record<string, CompetitionMode> = {};
  if (raw.competitions && typeof raw.competitions === 'object') {
    for (const [k, mode] of Object.entries(raw.competitions)) {
      if (mode === 'off' || mode === 'teams' || mode === 'all') comps[k] = mode;
    }
  }
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const rs = (raw.settings ?? {}) as Partial<Settings>;
  if (typeof rs.lockKnockoutOpponents === 'boolean')
    settings.lockKnockoutOpponents = rs.lockKnockoutOpponents;
  if (typeof rs.embedMask === 'boolean') settings.embedMask = rs.embedMask;
  if (typeof rs.upcomingDays === 'number' && rs.upcomingDays >= 1 && rs.upcomingDays <= 30) {
    settings.upcomingDays = Math.round(rs.upcomingDays);
  }
  if (typeof rs.syncEndpoint === 'string' && /^https:\/\//.test(rs.syncEndpoint)) {
    settings.syncEndpoint = rs.syncEndpoint;
  }
  if (typeof rs.syncKey === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(rs.syncKey)) {
    settings.syncKey = rs.syncKey;
  }
  return {
    v: 1,
    teams: strArray(raw.teams) ?? base.teams,
    competitions: comps,
    watched: numRecord(raw.watched),
    unlocked: numRecord(raw.unlocked),
    settings,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

/**
 * 合并两份状态（例如导入同步码）：
 * 已看记录取并集；订阅和设置以较新的一份为准。
 */
export function mergeUserState(local: UserState, incoming: UserState): UserState {
  const newer = incoming.updatedAt >= local.updatedAt ? incoming : local;
  const union = (a: Record<string, number>, b: Record<string, number>) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
    return out;
  };
  return {
    v: 1,
    teams: [...newer.teams],
    competitions: { ...newer.competitions },
    settings: { ...newer.settings },
    watched: union(local.watched, incoming.watched),
    unlocked: union(local.unlocked, incoming.unlocked),
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
  };
}

export function competitionMode(state: UserState, competitionId: string): CompetitionMode {
  return state.competitions[competitionId] ?? defaultCompetitionMode(competitionId);
}

export function isSubscribed(match: PublicMatch, state: UserState): boolean {
  const mode = competitionMode(state, match.competition);
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return state.teams.includes(match.home.id) || state.teams.includes(match.away.id);
}

export function isWatched(state: UserState, matchId: string): boolean {
  return Boolean(state.watched[matchId]);
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 某个北京时间日期的 00:00 对应的 UTC 毫秒数 */
function beijingMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`);
}

/**
 * "昨夜今晨"的时间窗：北京时间前一天 12:00 到当天 12:00。
 * offsetDays 为 -1 表示再往前一晚。
 */
export function nightWindow(
  now: Date,
  offsetDays = 0,
): { start: number; end: number; date: string } {
  const today = beijingDate(now);
  const end = beijingMidnight(today) + 12 * HOUR + offsetDays * DAY;
  return { start: end - DAY, end, date: beijingDate(new Date(end)) };
}

const byKickoff = (a: PublicMatch, b: PublicMatch) =>
  Date.parse(a.kickoff) - Date.parse(b.kickoff) || a.id.localeCompare(b.id);

export function matchesInWindow(
  matches: PublicMatch[],
  state: UserState,
  window: { start: number; end: number },
): PublicMatch[] {
  return matches
    .filter((m) => {
      const t = Date.parse(m.kickoff);
      return t >= window.start && t < window.end && isSubscribed(m, state);
    })
    .sort(byKickoff);
}

/** 最近 N 天已结束、还没看的订阅比赛 */
export function unwatchedRecent(
  matches: PublicMatch[],
  state: UserState,
  now: Date,
  days = 7,
): PublicMatch[] {
  const since = now.getTime() - days * DAY;
  return matches
    .filter(
      (m) =>
        Date.parse(m.kickoff) >= since &&
        liveStatus(m, now) === 'finished' &&
        isSubscribed(m, state) &&
        !isWatched(state, m.id),
    )
    .sort(byKickoff);
}

export function upcomingMatches(
  matches: PublicMatch[],
  state: UserState,
  now: Date,
  days = state.settings.upcomingDays,
): PublicMatch[] {
  const until = now.getTime() + days * DAY;
  return matches
    .filter((m) => {
      const t = Date.parse(m.kickoff);
      return t > now.getTime() && t <= until && isSubscribed(m, state);
    })
    .sort(byKickoff);
}

/**
 * 淘汰赛对阵会暴露前一轮的晋级者。
 * 如果这两支球队在同一赛事里还有更早阶段、已结束但没看完的订阅比赛，就锁定队名。
 */
export function isFixtureLocked(
  match: PublicMatch,
  all: PublicMatch[],
  state: UserState,
  now: Date,
): boolean {
  if (!state.settings.lockKnockoutOpponents) return false;
  if (!isKnockoutStage(match.stage)) return false;
  if (state.unlocked[`fixture:${match.id}`]) return false;
  if (isWatched(state, match.id)) return false;
  const kickoff = Date.parse(match.kickoff);
  const order = stageOrder(match.stage);
  const teams = new Set([match.home.id, match.away.id]);
  return all.some((prev) => {
    if (prev.id === match.id || prev.competition !== match.competition) return false;
    if (prev.season !== match.season) return false;
    if (!teams.has(prev.home.id) && !teams.has(prev.away.id)) return false;
    const t = Date.parse(prev.kickoff);
    if (t >= kickoff || kickoff - t > 60 * DAY) return false;
    // 同一轮的首回合不暴露次回合对阵
    if (stageOrder(prev.stage) >= order) return false;
    if (liveStatus(prev, now) === 'upcoming') return false;
    return isSubscribed(prev, state) && !isWatched(state, prev.id);
  });
}

/** 节目是否锁定：关联赛事最近 coverageDays 天内有没看完的订阅比赛 */
export function programLockReasons(
  program: Program,
  matches: PublicMatch[],
  state: UserState,
  now: Date,
): PublicMatch[] {
  if (program.spoilerRisk === 'low') return [];
  if (state.unlocked[`program:${program.id}:${beijingDate(now)}`]) return [];
  const since = now.getTime() - program.coverageDays * DAY;
  return matches.filter(
    (m) =>
      (program.relatedCompetitions.length === 0 ||
        program.relatedCompetitions.includes(m.competition)) &&
      Date.parse(m.kickoff) >= since &&
      liveStatus(m, now) !== 'upcoming' &&
      isSubscribed(m, state) &&
      !isWatched(state, m.id),
  );
}

export function allCompetitionIds(): string[] {
  return COMPETITIONS.map((c) => c.id);
}
