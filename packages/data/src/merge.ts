import { getCompetition, isKnockoutStage, type PublicMatch, type ScoreRecord } from '@sff/core';
import { matchId } from './normalize.ts';
import type { RawFixture } from './types.ts';
import { DAY_MS } from './time.ts';

export interface MergedMatch {
  match: Omit<PublicMatch, 'links'>;
  score?: ScoreRecord;
}

/** 同一场比赛在不同来源里开球时间可能差一点（改期），4 天内视为同一场 */
const SAME_MATCH_WINDOW = 4 * DAY_MS;

/**
 * 合并多个来源：同赛事、同主客队、开球时间相近的视为同一场。
 * 字段以优先级高的来源为准；比分取优先级最高且有比分的来源。
 */
export function mergeFixtures(
  fixtures: RawFixture[],
  priority: Record<string, number>,
  updatedAt: string,
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

  const merged: MergedMatch[] = [];
  for (const clusters of groups.values()) {
    for (const cluster of clusters) {
      const base = cluster[0]!;
      const pick = <K extends keyof RawFixture>(k: K) =>
        cluster.find((f) => f[k] !== undefined)?.[k];
      // 有确切开球时间的来源优先于"时间待定"
      const timed = cluster.find((f) => !f.timeTbd) ?? base;
      const match: Omit<PublicMatch, 'links'> = {
        id: '',
        competition: base.competition,
        season: base.season,
        stage: base.stage,
        kickoff: timed.kickoff,
        home: base.home,
        away: base.away,
        status: base.status,
        sources: [...new Set(cluster.map((f) => f.source))],
      };
      const matchday = pick('matchday');
      const group = pick('group');
      if (matchday) match.matchday = matchday as number;
      if (group) match.group = group as string;
      if (timed.timeTbd) match.timeTbd = true;
      match.id = matchId(match);
      const scored = cluster.find((f) => f.finished && f.score);
      const entry: MergedMatch = { match };
      if (scored?.score) {
        entry.score = { id: match.id, ...scored.score, source: scored.source, updatedAt };
      }
      merged.push(entry);
    }
  }
  assignLegs(merged);
  return merged.sort(
    (a, b) =>
      Date.parse(a.match.kickoff) - Date.parse(b.match.kickoff) ||
      a.match.id.localeCompare(b.match.id),
  );
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
    if (gap > 60 * DAY_MS) continue;
    const first = Date.parse(m.match.kickoff) < Date.parse(other.match.kickoff);
    m.match.leg = first ? 1 : 2;
    if (!first && m.score && other.score) {
      // 次回合主队 = 首回合客队
      m.score.aggregate = [m.score.home + other.score.away, m.score.away + other.score.home];
    }
  }
}
