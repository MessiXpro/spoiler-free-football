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
  /**
   * 订阅、赛事和设置的最近修改时间（毫秒）。标记已看等操作只更新 updatedAt，不更新这个，
   * 否则只点了"显示比分"的设备会把别的设备上更新过的订阅盖掉。旧数据没有这一项时用 updatedAt。
   */
  prefsUpdatedAt?: number;
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
  const out: UserState = {
    v: 1,
    teams: strArray(raw.teams) ?? base.teams,
    competitions: comps,
    watched: numRecord(raw.watched),
    unlocked: numRecord(raw.unlocked),
    settings,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
  if (typeof raw.prefsUpdatedAt === 'number' && Number.isFinite(raw.prefsUpdatedAt)) {
    out.prefsUpdatedAt = raw.prefsUpdatedAt;
  }
  return out;
}

/** 订阅和设置的修改时间（旧数据没有单独记录时退回 updatedAt） */
export function prefsTime(state: UserState): number {
  return state.prefsUpdatedAt ?? state.updatedAt;
}

/**
 * 合并两份状态（例如导入同步码）：
 * 已看记录取并集；订阅和设置以较新的一份为准（按订阅和设置本身的修改时间，不看已看记录的变化）。
 */
export function mergeUserState(local: UserState, incoming: UserState): UserState {
  const newer = prefsTime(incoming) >= prefsTime(local) ? incoming : local;
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
    prefsUpdatedAt: Math.max(prefsTime(local), prefsTime(incoming)),
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

/**
 * 延期/取消的比赛没有比分可看，用户可以手动"标记为已看"，解除它对节目和下一轮对阵的折叠。
 * 比赛 id 里没有日期，改期后重新安排的那场还是同一个 id，所以不能记进 watched，
 * 而是按原定开球时间记一条解锁：改期后的那场照常算没看。
 */
export function postponedClearKey(match: Pick<PublicMatch, 'id' | 'kickoff'>): string {
  return `postponed:${match.id}:${Date.parse(match.kickoff)}`;
}

/** 这场延期/取消的比赛是否被手动标记过（状态恢复正常或开球时间变了就不再算） */
export function isPostponedCleared(
  state: UserState,
  match: Pick<PublicMatch, 'id' | 'kickoff' | 'status'>,
): boolean {
  return match.status !== 'scheduled' && Boolean(state.unlocked[postponedClearKey(match)]);
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

/** 往前看多少天内的前一轮比赛（数据管线默认也公开这么多天的已结束比赛，见 packages/data/src/build.ts） */
export const FIXTURE_LOCK_LOOKBACK_DAYS = 60;

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
    if (t >= kickoff || kickoff - t > FIXTURE_LOCK_LOOKBACK_DAYS * DAY) return false;
    // 同一轮的首回合不暴露次回合对阵
    if (stageOrder(prev.stage) >= order) return false;
    // 还没到开球时间的不算（包括提前宣布延期/取消的比赛）
    if (t > now.getTime() || liveStatus(prev, now) === 'upcoming') return false;
    if (isPostponedCleared(state, prev)) return false;
    return isSubscribed(prev, state) && !isWatched(state, prev.id);
  });
}

/** 两回合淘汰赛的次回合对应的首回合（同赛事、同赛季、同阶段，主客对调）；找不到返回 undefined */
export function firstLegOf(match: PublicMatch, all: PublicMatch[]): PublicMatch | undefined {
  if (match.leg !== 2) return undefined;
  return all.find(
    (m) =>
      m.leg === 1 &&
      m.id !== match.id &&
      m.competition === match.competition &&
      m.season === match.season &&
      m.stage === match.stage &&
      m.home.id === match.away.id &&
      m.away.id === match.home.id,
  );
}

/**
 * 次回合的「两回合总比分」能倒推出首回合比分：只有首回合已看（或根本不是次回合）才显示。
 * 首回合不在数据里（太早、不在订阅范围）时也不显示，宁可少看一个数字
 */
export function canShowAggregate(
  match: PublicMatch,
  all: PublicMatch[],
  state: UserState,
): boolean {
  if (match.leg !== 2) return true;
  const first = firstLegOf(match, all);
  return Boolean(first && isWatched(state, first.id));
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
      // 还没到开球时间的不算（提前宣布延期/取消的比赛 liveStatus 不是 upcoming，要单独排除）
      Date.parse(m.kickoff) <= now.getTime() &&
      liveStatus(m, now) !== 'upcoming' &&
      !isPostponedCleared(state, m) &&
      isSubscribed(m, state) &&
      !isWatched(state, m.id),
  );
}

export function allCompetitionIds(): string[] {
  return COMPETITIONS.map((c) => c.id);
}
