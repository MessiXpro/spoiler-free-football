import { getCompetition, isKnockoutStage, type PublicMatch, type ScoreRecord } from '@sff/core';
import { matchId } from './normalize.ts';
import type { RawFixture } from './types.ts';
import { DAY_MS, seasonOf } from './time.ts';

export interface MergedMatch {
  match: Omit<PublicMatch, 'links'>;
  score?: ScoreRecord;
  /** 比分含点球大战进球（只在内部用，不写进比分文件）：不拿它算两回合总比分 */
  scoreIncludesShootout?: boolean;
}

/** 同一场比赛在不同来源里开球时间可能差一点（改期），4 天内视为同一场 */
const SAME_MATCH_WINDOW = 4 * DAY_MS;

/** 两回合的间隔上限（天）：管线会多拉这么长的历史，用来找首回合 */
export const MAX_LEG_GAP_DAYS = 60;

/** 开球已过这么久还没有任何来源报告完赛的日期，视为改期前的旧日期 */
const STALE_AFTER = DAY_MS;

/**
 * 合并多个来源：同赛事、同主客队、开球时间相近的视为同一场。
 * 字段以优先级高的来源为准；比分取优先级最高且比分完整的来源。
 * 改期超过 4 天、某个来源还停在旧日期时会分成两簇；id 相同（联赛、小组赛、同一淘汰阶段）的簇再合成一场，
 * 不会出现两条 id 相同的比赛。
 * now：生成数据的时间（判断旧日期是否已过时），默认取 updatedAt
 */
export function mergeFixtures(
  fixtures: RawFixture[],
  priority: Record<string, number>,
  updatedAt: string,
  now: Date = new Date(updatedAt),
): MergedMatch[] {
  const prio = (f: RawFixture) => priority[f.source] ?? 0;
  const groups = new Map<string, RawFixture[][]>();
  const sorted = reconcileUnknownTeams([...fixtures].sort((a, b) => prio(b) - prio(a)));
  for (const f of sorted) {
    const key = `${f.competition}|${f.home.id}|${f.away.id}`;
    const clusters = groups.get(key) ?? [];
    const t = Date.parse(f.kickoff);
    const cluster = clusters.find(
      (c) => Math.abs(Date.parse(c[0]!.kickoff) - t) <= SAME_MATCH_WINDOW,
    );
    if (cluster) cluster.push(f);
    else clusters.push([f]);
    groups.set(key, clusters);
  }

  // 按比赛 id 再归并一次（簇按簇首的优先级排序；同一 id 一定在同一组里）
  const byId = new Map<string, RawFixture[][]>();
  for (const clusters of groups.values()) {
    for (const cluster of clusters) {
      const id = mergeCluster(cluster, updatedAt).match.id;
      byId.set(id, [...(byId.get(id) ?? []), cluster]);
    }
  }
  const merged: MergedMatch[] = [];
  const seen = new Set<string>();
  for (const clusters of byId.values()) {
    // 用哪个日期的簇作为基准（开球时间、状态、比分都以它为准），其他簇只补充字段
    const main = primaryCluster(clusters, now.getTime(), updatedAt);
    const rest = clusters
      .filter((c) => c !== main)
      .flat()
      .sort((a, b) => prio(b) - prio(a));
    const entry = mergeCluster([...main, ...rest], updatedAt);
    // 保险：重新合并后 id 仍然撞车时只保留优先级高的那条
    if (seen.has(entry.match.id)) continue;
    seen.add(entry.match.id);
    merged.push(entry);
  }
  assignLegs(merged);
  return merged.sort(
    (a, b) =>
      Date.parse(a.match.kickoff) - Date.parse(b.match.kickoff) ||
      a.match.id.localeCompare(b.match.id),
  );
}

/**
 * 同一 id 有几个相差 4 天以上的日期（改期后某个来源还停在旧日期）时用哪一个：默认用优先级最高的来源的。
 * 但它报告延期/取消、或开球已过一天还没有完赛时，比赛没在那天踢——改用之后的另一个日期。
 * 否则改期的比赛会停在旧日期（显示成延期或"已结束"），过了公开时间窗就整场消失，看不到新日期。
 */
function primaryCluster(clusters: RawFixture[][], now: number, updatedAt: string): RawFixture[] {
  const info = clusters.map((c) => {
    const { match } = mergeCluster(c, updatedAt);
    const t = Date.parse(match.kickoff);
    const played = c.some((f) => f.finished);
    const notHere =
      !played &&
      (match.status === 'postponed' || match.status === 'cancelled' || t + STALE_AFTER < now);
    return { c, t, notHere };
  });
  const head = info[0]!;
  if (!head.notHere) return head.c;
  return info.find((i) => !i.notHere && i.t > head.t)?.c ?? head.c;
}

/** 赛季没有任何来源提供时（只有手工条目）：国家队赛事、世俱杯按自然年，其余按 "2026-27" */
function defaultSeason(competition: string, kickoff: string): string {
  const comp = getCompetition(competition);
  if (comp?.national || competition === 'club-world-cup') return kickoff.slice(0, 4);
  return seasonOf(new Date(kickoff));
}

/** 一簇（第一个是基准来源，一般就是优先级最高的；其余按优先级从高到低）→ 一场比赛 */
function mergeCluster(cluster: RawFixture[], updatedAt: string): MergedMatch {
  const base = cluster[0]!;
  const anchor = Date.parse(base.kickoff);
  // 和最高优先级来源的开球时间相差 4 天以内的才算"同一时间"的报告（改期前的旧日期不算）
  const near = (f: RawFixture) => Math.abs(Date.parse(f.kickoff) - anchor) <= SAME_MATCH_WINDOW;
  const pick = <K extends keyof RawFixture>(k: K, only: (f: RawFixture) => boolean = () => true) =>
    cluster.find((f) => f[k] !== undefined && only(f))?.[k];
  // 有确切开球时间的来源优先于"时间待定"
  const timed = cluster.find((f) => !f.timeTbd && near(f)) ?? base;
  const match: Omit<PublicMatch, 'links'> = {
    id: '',
    competition: base.competition,
    // 手工条目没写赛季/阶段/状态时，取其他来源的
    season: pick('season') ?? defaultSeason(base.competition, base.kickoff),
    stage: pick('stage') ?? 'regular',
    kickoff: timed.kickoff,
    home: base.home,
    away: base.away,
    status: pick('status', near) ?? 'scheduled',
    sources: [...new Set(cluster.map((f) => f.source))],
  };
  const matchday = pick('matchday');
  const group = pick('group');
  if (matchday) match.matchday = matchday as number;
  if (group) match.group = group as string;
  if (timed.timeTbd) match.timeTbd = true;
  match.id = matchId(match);
  // 比分：先看完整度，再看优先级。
  // 有来源说是点球大战决胜时，没有点球比分的记录看不出谁晋级；含点球大战进球的比分连加时比分都不对
  const finished = cluster.filter((f) => f.finished && f.score && near(f));
  const shootout = finished.some(
    (f) => f.penaltyShootout || f.scoreIncludesShootout || f.score!.penalties,
  );
  const rank = (f: RawFixture) =>
    f.scoreIncludesShootout ? 2 : shootout && !f.score!.penalties ? 1 : 0;
  // finished 已按优先级排序：同一档里取第一个
  const scored = finished.reduce<RawFixture | undefined>(
    (best, f) => (!best || rank(f) < rank(best) ? f : best),
    undefined,
  );
  const entry: MergedMatch = { match };
  if (scored?.score) {
    entry.score = { id: match.id, ...scored.score, source: scored.source, updatedAt };
    if (scored.scoreIncludesShootout) entry.scoreIncludesShootout = true;
  }
  return entry;
}

/**
 * 目录外的小球队在不同来源里写法不同（"Wycombe" / "Wycombe Wanderers FC"），生成的 x- id 对不上。
 * 同赛事、开球相差 3 小时内、另一支球队相同的两场，视为同一场，统一用优先级高的来源的球队。
 */
function reconcileUnknownTeams(sorted: RawFixture[]): RawFixture[] {
  const HOURS_3 = 3 * 60 * 60 * 1000;
  return sorted.map((f, i) => {
    if (!f.home.id.startsWith('x-') && !f.away.id.startsWith('x-')) return f;
    const t = Date.parse(f.kickoff);
    const better = sorted
      .slice(0, i)
      .find(
        (o) =>
          o.source !== f.source &&
          o.competition === f.competition &&
          Math.abs(Date.parse(o.kickoff) - t) <= HOURS_3 &&
          (o.home.id === f.home.id || o.away.id === f.away.id),
      );
    return better ? { ...f, home: better.home, away: better.away } : f;
  });
}

/** 两回合淘汰赛：同阶段 A-B 与 B-A 都存在时，早的为首回合；次回合补上总比分 */
function assignLegs(merged: MergedMatch[]) {
  const byKey = new Map<string, MergedMatch>();
  for (const m of merged) {
    const { competition, season, stage, home, away } = m.match;
    byKey.set(`${competition}|${season}|${stage}|${home.id}|${away.id}`, m);
  }
  for (const m of merged) {
    const { competition, season, stage, home, away } = m.match;
    if (!getCompetition(competition)?.twoLegged) continue;
    if (!isKnockoutStage(stage) || stage === 'final' || stage === 'third-place') continue;
    if (competition === 'nations-league' && stage !== 'quarter-final' && stage !== 'playoff')
      continue;
    const other = byKey.get(`${competition}|${season}|${stage}|${away.id}|${home.id}`);
    if (!other) continue;
    const gap = Math.abs(Date.parse(other.match.kickoff) - Date.parse(m.match.kickoff));
    if (gap > MAX_LEG_GAP_DAYS * DAY_MS) continue;
    const first = Date.parse(m.match.kickoff) < Date.parse(other.match.kickoff);
    m.match.leg = first ? 1 : 2;
    // 任一回合的比分含点球大战进球时算不出正确的总比分，宁可不给
    const inflated = m.scoreIncludesShootout || other.scoreIncludesShootout;
    if (!first && m.score && other.score && !inflated) {
      // 次回合主队 = 首回合客队
      m.score.aggregate = [m.score.home + other.score.away, m.score.away + other.score.home];
    }
  }
}
