import type { ScheduleStatus, Stage } from '@sff/core';
import type { AdapterContext, AdapterResult, FixtureAdapter, RawFixture } from '../types.ts';
import { isNationalCompetition, teamRef } from '../normalize.ts';

/**
 * 手工补充的比赛（config/manual-matches.json）：
 * 数据源没覆盖的重要友谊赛、临时改期等。优先级最高，会覆盖其他来源的开球时间。
 */
export interface ManualMatch {
  competition: string;
  season?: string;
  stage?: Stage;
  matchday?: number;
  group?: string;
  /** 带时区的时间，例如 "2026-11-14T20:00:00+00:00" */
  kickoff: string;
  timeTbd?: boolean;
  home: string;
  away: string;
  status?: ScheduleStatus;
}

export interface ManualConfig {
  matches?: ManualMatch[];
}

export function parseManual(config: ManualConfig): RawFixture[] {
  const out: RawFixture[] = [];
  for (const [i, m] of (config.matches ?? []).entries()) {
    const t = Date.parse(m.kickoff);
    if (!m.competition || !m.home || !m.away || Number.isNaN(t)) continue;
    const kickoff = new Date(t).toISOString();
    const national = isNationalCompetition(m.competition);
    out.push({
      source: 'manual',
      sourceId: `manual-${i}`,
      competition: m.competition,
      // 没写的赛季/阶段/状态不填默认值：合并时取其他来源的。
      // 否则一条只写了开球时间的改期条目会改掉比赛 id、把淘汰赛变成联赛（不再锁定对阵）、盖掉延期状态
      ...(m.season ? { season: m.season } : {}),
      ...(m.stage
        ? { stage: m.stage }
        : m.competition === 'friendlies'
          ? { stage: 'friendly' as const }
          : {}),
      ...(m.matchday ? { matchday: m.matchday } : {}),
      ...(m.group ? { group: m.group } : {}),
      kickoff,
      ...(m.timeTbd ? { timeTbd: true } : {}),
      home: teamRef(m.home, national),
      away: teamRef(m.away, national),
      ...(m.status ? { status: m.status } : {}),
      finished: false,
    });
  }
  return out;
}

export function createManualAdapter(config: ManualConfig): FixtureAdapter {
  return {
    id: 'manual',
    name: '手工补充',
    priority: 100,
    async fetch(ctx: AdapterContext): Promise<AdapterResult> {
      const fixtures = parseManual(config).filter((f) => {
        const t = Date.parse(f.kickoff);
        return t >= ctx.windowStart.getTime() && t <= ctx.windowEnd.getTime();
      });
      return { fixtures, notes: [] };
    },
  };
}
