import { competitionName } from '@sff/core';
import type { AdapterContext, AdapterResult, FixtureAdapter, RawFixture } from '../types.ts';
import { isNationalCompetition, pair, stageFromApiFootball, teamRef } from '../normalize.ts';
import { isoDate } from '../time.ts';
import { envList, envValue } from '../env.ts';

/**
 * API-Football v3（可选，环境变量 APIFOOTBALL_KEY）。
 * 免费档每天 100 次；免费档可能不开放当前赛季（需要在 GitHub Actions 里用真实 Key 验证），
 * 因此默认不依赖它，只在设置了 Key 时作为补充来源。
 */

const BASE = 'https://v3.football.api-sports.io';

/** API-Football 联赛 id → 本项目赛事 id（标注 * 的 id 尚未在真实数据中核实） */
export const API_FOOTBALL_LEAGUES: Record<string, string> = {
  '39': 'epl',
  '140': 'laliga',
  '2': 'ucl',
  '3': 'uel',
  '848': 'uecl',
  '45': 'fa-cup',
  '48': 'efl-cup', // *
  '528': 'community-shield', // *
  '143': 'copa-del-rey',
  '556': 'supercopa', // *
  '531': 'uefa-super-cup',
  '15': 'club-world-cup',
  '5': 'nations-league',
  '10': 'friendlies', // *
  '32': 'wc-qualifiers',
  '34': 'wc-qualifiers',
  '960': 'euro-qualifiers', // *
  '4': 'euro',
  '9': 'copa-america',
  '1': 'world-cup',
};

export const DEFAULT_API_FOOTBALL_LEAGUES = [
  '45',
  '48',
  '528',
  '143',
  '556',
  '3',
  '848',
  '5',
  '10',
  '32',
  '34',
  '960',
  '15',
];

export interface AfFixture {
  fixture: { id: number; date: string; timestamp?: number; status: { short: string } };
  league: { id: number; season: number; round: string };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
  score?: {
    halftime?: { home: number | null; away: number | null };
    fulltime?: { home: number | null; away: number | null };
    extratime?: { home: number | null; away: number | null };
    penalty?: { home: number | null; away: number | null };
  };
}

interface AfResponse {
  errors?: unknown;
  response?: AfFixture[];
}

const FINISHED = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

function seasonLabel(competition: string, season: number): string {
  if (['friendlies', 'world-cup', 'euro', 'copa-america', 'club-world-cup'].includes(competition)) {
    return String(season);
  }
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`;
}

export function parseApiFootballFixture(f: AfFixture): RawFixture | null {
  const competition = API_FOOTBALL_LEAGUES[String(f.league?.id)];
  if (!competition || !f.teams?.home?.name || !f.teams?.away?.name) return null;
  const national = isNationalCompetition(competition);
  const short = f.fixture.status?.short ?? '';
  const finished = FINISHED.has(short);
  const { stage, matchday, group } = stageFromApiFootball(f.league.round ?? '');
  const fixture: RawFixture = {
    source: 'api-football',
    sourceId: String(f.fixture.id),
    competition: competition === 'friendlies' ? 'friendlies' : competition,
    season: seasonLabel(competition, f.league.season),
    stage: competition === 'friendlies' ? 'friendly' : stage,
    ...(matchday ? { matchday } : {}),
    ...(group ? { group } : {}),
    kickoff: new Date(f.fixture.date).toISOString(),
    ...(short === 'TBD' ? { timeTbd: true } : {}),
    home: teamRef(f.teams.home.name, national),
    away: teamRef(f.teams.away.name, national),
    status: ['PST', 'SUSP', 'INT'].includes(short)
      ? 'postponed'
      : ['CANC', 'ABD'].includes(short)
        ? 'cancelled'
        : 'scheduled',
    finished,
  };
  const goals = pair(f.goals?.home, f.goals?.away);
  if (finished && goals) {
    const ht = pair(f.score?.halftime?.home, f.score?.halftime?.away);
    const ft = pair(f.score?.fulltime?.home, f.score?.fulltime?.away);
    const pens = pair(f.score?.penalty?.home, f.score?.penalty?.away);
    const et = short === 'AET' || short === 'PEN';
    fixture.score = {
      home: goals[0],
      away: goals[1],
      ...(ht ? { halfTime: ht } : {}),
      ...(et ? { extraTime: true } : {}),
      ...(et && ft ? { regularTime: ft } : {}),
      ...(pens ? { penalties: pens } : {}),
    };
    if (short === 'PEN') fixture.penaltyShootout = true;
  }
  return fixture;
}

function hasErrors(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors)) return errors.length ? JSON.stringify(errors) : null;
  if (typeof errors === 'object') {
    const values = Object.values(errors as Record<string, unknown>);
    return values.length ? values.map(String).join('; ') : null;
  }
  return String(errors);
}

export function createApiFootballAdapter(): FixtureAdapter {
  return {
    id: 'api-football',
    name: 'API-Football',
    priority: 30,
    unavailableReason: (env) =>
      envValue(env, 'APIFOOTBALL_KEY') ? null : '未设置 APIFOOTBALL_KEY，跳过',
    async fetch(ctx: AdapterContext): Promise<AdapterResult> {
      const key = envValue(ctx.env, 'APIFOOTBALL_KEY') ?? '';
      const leagues = envList(ctx.env, 'APIFOOTBALL_LEAGUES', DEFAULT_API_FOOTBALL_LEAGUES, (id) =>
        Boolean(API_FOOTBALL_LEAGUES[id]),
      );
      const fixtures: RawFixture[] = [];
      const notes: string[] = [];
      const from = isoDate(ctx.windowStart);
      const to = isoDate(ctx.windowEnd);
      const clock = ctx.clock ?? Date.now;
      const overBudget = () => ctx.deadline !== undefined && clock() > ctx.deadline;
      const skipped: string[] = [];
      for (const id of leagues) {
        const competition = API_FOOTBALL_LEAGUES[id]!;
        // 超过用时上限：剩下的赛事这次不拉（和 TheSportsDB 一样）
        if (overBudget()) {
          skipped.push(competitionName(competition));
          continue;
        }
        // 赛季 = 开始年份；国家队/世俱杯按自然年
        const year = ctx.now.getUTCFullYear();
        const clubSeason = ctx.now.getUTCMonth() >= 6 ? year : year - 1;
        const season = [
          'friendlies',
          'world-cup',
          'euro',
          'copa-america',
          'club-world-cup',
          'wc-qualifiers',
          'euro-qualifiers',
        ].includes(competition)
          ? year
          : clubSeason;
        const url = `${BASE}/fixtures?league=${id}&season=${season}&from=${from}&to=${to}&timezone=UTC`;
        try {
          const data = await ctx.fetcher.getJson<AfResponse>(url, {
            kind: 'api',
            headers: { 'x-apisports-key': key },
            ttlMs: 5 * 60 * 60 * 1000,
            // 额度用完、Key 或套餐不对时接口仍返回 HTTP 200 + errors：不缓存，修好 Key 后下一次运行就能拿到数据
            cacheable: (body) => {
              try {
                return !hasErrors((JSON.parse(body) as AfResponse).errors);
              } catch {
                return false;
              }
            },
          });
          const err = hasErrors(data.errors);
          if (err) {
            notes.push(`API-Football 联赛 ${id} 失败：${err}`);
            continue;
          }
          for (const f of data.response ?? []) {
            const parsed = parseApiFootballFixture(f);
            if (parsed) fixtures.push(parsed);
          }
        } catch (e) {
          notes.push(`API-Football 联赛 ${id} 失败：${(e as Error).message}`);
        }
      }
      ctx.log(`api-football: ${fixtures.length} 场`);
      if (skipped.length) {
        notes.push(`超过用时上限，这次没拉取（失败）：${[...new Set(skipped)].join('、')}`);
      }
      return { fixtures, notes };
    },
  };
}
