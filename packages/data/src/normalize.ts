import { findTeam, getCompetition, slugTeamId, type Stage, type TeamRef } from '@sff/core';

/** 数据源球队名 → 目录球队（找不到就生成 x- 开头的稳定 id） */
export function teamRef(name: string, national?: boolean): TeamRef {
  const clean = name.trim();
  const team = findTeam(clean, national);
  return team ? { id: team.id, name: team.zh } : { id: slugTeamId(clean), name: clean };
}

export function isNationalCompetition(competition: string): boolean {
  return Boolean(getCompetition(competition)?.national);
}

/** football-data.org 的 stage 字段 */
export function stageFromFootballData(stage: string | null | undefined): Stage {
  switch ((stage ?? '').toUpperCase()) {
    case 'REGULAR_SEASON':
      return 'regular';
    case 'LEAGUE_STAGE':
    case 'LEAGUE_PHASE':
      return 'league-phase';
    case 'GROUP_STAGE':
      return 'group';
    case 'PLAYOFFS':
    case 'PLAY_OFFS':
    case 'PLAYOFF_ROUND_1':
    case 'PLAYOFF_ROUND_2':
    case 'KNOCKOUT_ROUND_PLAY_OFFS':
      return 'playoff';
    case 'LAST_64':
      return 'round-of-64';
    case 'LAST_32':
      return 'round-of-32';
    case 'LAST_16':
      return 'round-of-16';
    case 'QUARTER_FINALS':
      return 'quarter-final';
    case 'SEMI_FINALS':
      return 'semi-final';
    case 'THIRD_PLACE':
      return 'third-place';
    case 'FINAL':
      return 'final';
    case 'ROUND_1':
      return 'round-1';
    case 'ROUND_2':
      return 'round-2';
    case 'ROUND_3':
      return 'round-3';
    case 'ROUND_4':
      return 'round-4';
    default:
      if (/QUALIF|PRELIMINARY/.test((stage ?? '').toUpperCase())) return 'qualifying';
      return 'regular';
  }
}

/** API-Football 的 league.round 字符串 */
export function stageFromApiFootball(round: string): {
  stage: Stage;
  matchday?: number;
  group?: string;
} {
  const r = round.trim();
  const num = Number(r.match(/(\d+)\s*$/)?.[1]);
  const md = Number.isFinite(num) && num > 0 ? num : undefined;
  if (/^Regular Season/i.test(r)) return { stage: 'regular', matchday: md };
  if (/^League Stage|^League Phase/i.test(r)) return { stage: 'league-phase', matchday: md };
  const group = r.match(/^Group\s+([A-L])\b/i)?.[1]?.toUpperCase();
  if (group) return { stage: 'group', group, matchday: md };
  if (/^Group Stage/i.test(r)) return { stage: 'group', matchday: md };
  if (/^League [A-D]\b/i.test(r))
    return { stage: 'group', group: r.match(/^League ([A-D])/i)?.[1], matchday: md };
  if (/qualif|preliminary/i.test(r)) return { stage: 'qualifying' };
  if (/play-?offs?/i.test(r)) return { stage: 'playoff' };
  if (/^Round of 64|32nd Finals/i.test(r)) return { stage: 'round-of-64' };
  if (/^Round of 32|16th Finals/i.test(r)) return { stage: 'round-of-32' };
  if (/^Round of 16|8th Finals/i.test(r)) return { stage: 'round-of-16' };
  if (/^Quarter/i.test(r)) return { stage: 'quarter-final' };
  if (/^Semi/i.test(r)) return { stage: 'semi-final' };
  if (/3rd Place|Third Place/i.test(r)) return { stage: 'third-place' };
  if (/^Final$/i.test(r)) return { stage: 'final' };
  const nth = r.match(/^(\d)(?:st|nd|rd|th) Round/i)?.[1] ?? r.match(/^Round (\d)$/i)?.[1];
  if (nth) return { stage: cupRound(Number(nth)) };
  return { stage: 'regular', matchday: md };
}

export function cupRound(n: number): Stage {
  const clamped = Math.min(6, Math.max(1, Math.round(n)));
  return `round-${clamped}` as Stage;
}

/**
 * TheSportsDB 的 intRound：联赛是轮次；杯赛用特殊编码
 * （125 = 1/4 决赛，150 = 半决赛，160 = 附加赛，200 = 决赛，400 = 资格赛，500 = 季前赛）
 */
export function stageFromTheSportsDb(
  round: string | null | undefined,
  competition: string,
): { stage: Stage; matchday?: number } {
  const n = Number(round ?? '');
  const comp = getCompetition(competition);
  if (!Number.isFinite(n)) return { stage: 'regular' };
  if (competition === 'friendlies') return { stage: 'friendly' };
  switch (n) {
    case 125:
      return { stage: 'quarter-final' };
    case 150:
      return { stage: 'semi-final' };
    case 160:
      return { stage: 'playoff' };
    case 170:
      return { stage: 'third-place' };
    case 200:
      return { stage: 'final' };
    case 400:
      return { stage: 'qualifying' };
    case 500:
      return { stage: 'friendly' };
    case 64:
      return { stage: 'round-of-64' };
    case 32:
      return { stage: 'round-of-32' };
    case 16:
      return { stage: 'round-of-16' };
  }
  if (!comp) return { stage: 'regular', matchday: n || undefined };
  if (comp.kind === 'league') return { stage: 'regular', matchday: n || undefined };
  if (comp.kind === 'super-cup') return { stage: 'final' };
  if (comp.id === 'ucl' || comp.id === 'uel' || comp.id === 'uecl') {
    return n >= 1 && n <= 8 ? { stage: 'league-phase', matchday: n } : { stage: 'qualifying' };
  }
  if (comp.kind === 'international') return { stage: 'group', matchday: n || undefined };
  if (comp.kind === 'domestic-cup') return { stage: cupRound(n) };
  return { stage: 'regular', matchday: n || undefined };
}

/** 稳定的比赛 id：联赛 home-away 一个赛季唯一；淘汰赛加阶段；友谊赛加日期 */
export function matchId(input: {
  competition: string;
  season: string;
  stage: Stage;
  kickoff: string;
  home: TeamRef;
  away: TeamRef;
}): string {
  const base = `${input.competition}-${input.season}`;
  const pair = `${input.home.id}-${input.away.id}`;
  if (input.stage === 'friendly' || input.competition === 'friendlies') {
    return `${input.competition}-${input.kickoff.slice(0, 10)}-${pair}`;
  }
  if (['regular', 'league-phase', 'group'].includes(input.stage)) return `${base}-${pair}`;
  return `${base}-${input.stage}-${pair}`;
}

export function toInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function pair(a: unknown, b: unknown): [number, number] | undefined {
  const x = toInt(a);
  const y = toInt(b);
  return x === undefined || y === undefined ? undefined : [x, y];
}
