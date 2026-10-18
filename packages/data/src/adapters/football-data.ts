import type { AdapterContext, AdapterResult, FixtureAdapter, RawFixture } from '../types.ts';
import {
  isNationalCompetition,
  pair,
  stageFromFootballData,
  teamRef,
  toInt,
} from '../normalize.ts';
import { DAY_MS, isoDate } from '../time.ts';
import { envList, envValue } from '../env.ts';

/**
 * football-data.org v4（需要免费注册 API Key，环境变量 FOOTBALL_DATA_TOKEN）。
 * 免费档覆盖：英超 PL、西甲 PD、欧冠 CL、欧洲杯 EC、世界杯 WC 等；
 * 足总杯、联赛杯、国王杯、欧联、欧协联属于付费档，可用 FOOTBALL_DATA_COMPETITIONS 追加。
 * 限速：免费档 10 次/分钟；/v4/matches 每次最多 10 天，dateTo 不含当天。
 */

const BASE = 'https://api.football-data.org/v4';

/** football-data 赛事代码 → 本项目赛事 id */
export const FOOTBALL_DATA_CODES: Record<string, string> = {
  PL: 'epl',
  PD: 'laliga',
  CL: 'ucl',
  EC: 'euro',
  WC: 'world-cup',
  // 以下为付费档
  FAC: 'fa-cup',
  FLC: 'efl-cup',
  COM: 'community-shield',
  CDR: 'copa-del-rey',
  EL: 'uel',
  UCL: 'uecl', // football-data 把欧协联的代码定为 "UCL"，注意不要和欧冠混淆
  ESC: 'uefa-super-cup',
  QUFA: 'wc-qualifiers',
  QCBL: 'wc-qualifiers',
  CA: 'copa-america',
};

export const FOOTBALL_DATA_FREE = ['PL', 'PD', 'CL', 'EC', 'WC'];

interface FdTeam {
  id: number;
  name: string | null;
  shortName?: string | null;
}

interface FdScorePart {
  home: number | null;
  away: number | null;
}

export interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string | null;
  group: string | null;
  competition: { id: number; code: string; name: string };
  season?: { startDate?: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score?: {
    winner?: string | null;
    duration?: string;
    fullTime?: FdScorePart;
    halfTime?: FdScorePart;
    regularTime?: FdScorePart;
    extraTime?: FdScorePart;
    penalties?: FdScorePart;
  };
}

function seasonFromMatch(m: FdMatch): string {
  const start = m.season?.startDate ?? m.utcDate;
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  const competition = FOOTBALL_DATA_CODES[m.competition.code];
  if (competition === 'world-cup' || competition === 'euro' || competition === 'copa-america') {
    return String(year);
  }
  const s = month >= 7 || m.season?.startDate ? year : year - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

export function parseFootballDataMatch(m: FdMatch): RawFixture | null {
  const competition = FOOTBALL_DATA_CODES[m.competition?.code];
  if (!competition || !m.homeTeam?.name || !m.awayTeam?.name) return null;
  const national = isNationalCompetition(competition);
  const status = m.status?.toUpperCase();
  const finished = status === 'FINISHED' || status === 'AWARDED';
  const fixture: RawFixture = {
    source: 'football-data',
    sourceId: String(m.id),
    competition,
    season: seasonFromMatch(m),
    stage: stageFromFootballData(m.stage),
    kickoff: new Date(m.utcDate).toISOString(),
    home: teamRef(m.homeTeam.name, national),
    away: teamRef(m.awayTeam.name, national),
    status:
      status === 'POSTPONED' || status === 'SUSPENDED'
        ? 'postponed'
        : status === 'CANCELLED'
          ? 'cancelled'
          : 'scheduled',
    finished,
  };
  // SCHEDULED 表示只确定了日期、开球时间未定
  if (status === 'SCHEDULED') fixture.timeTbd = true;
  const md = toInt(m.matchday);
  if (md) fixture.matchday = md;
  const group = m.group?.replace(/^GROUP_/, '');
  if (group && group.length <= 2) fixture.group = group;

  const s = m.score;
  const full = pair(s?.fullTime?.home, s?.fullTime?.away);
  if (finished && full) {
    const pens = pair(s?.penalties?.home, s?.penalties?.away);
    const regular = pair(s?.regularTime?.home, s?.regularTime?.away);
    const duration = s?.duration ?? 'REGULAR';
    // 注意：football-data 的 fullTime 包含加时和点球大战的进球
    let home = full[0];
    let away = full[1];
    let note: string | undefined;
    if (duration === 'PENALTY_SHOOTOUT') {
      if (pens) {
        home -= pens[0];
        away -= pens[1];
      } else {
        note = '数据源给出的比分包含点球大战进球';
      }
    }
    fixture.score = {
      home,
      away,
      ...(pair(s?.halfTime?.home, s?.halfTime?.away)
        ? { halfTime: pair(s?.halfTime?.home, s?.halfTime?.away) }
        : {}),
      ...(duration !== 'REGULAR' ? { extraTime: true } : {}),
      ...(duration !== 'REGULAR' && regular ? { regularTime: regular } : {}),
      ...(pens ? { penalties: pens } : {}),
      ...(note ? { note } : {}),
    };
    // 合并时优先用其他来源的正确比分，也不拿它算两回合总比分
    if (note) fixture.scoreIncludesShootout = true;
    if (duration === 'PENALTY_SHOOTOUT') fixture.penaltyShootout = true;
  }
  return fixture;
}

/** 正常响应一定有 matches 数组；报错内容（{ message, errorCode }）不缓存 */
function hasMatches(body: string): boolean {
  try {
    return Array.isArray((JSON.parse(body) as { matches?: unknown }).matches);
  } catch {
    return false;
  }
}

export function createFootballDataAdapter(): FixtureAdapter {
  return {
    id: 'football-data',
    name: 'football-data.org',
    priority: 40,
    unavailableReason: (env) =>
      envValue(env, 'FOOTBALL_DATA_TOKEN') ? null : '未设置 FOOTBALL_DATA_TOKEN，跳过',
    async fetch(ctx: AdapterContext): Promise<AdapterResult> {
      const token = envValue(ctx.env, 'FOOTBALL_DATA_TOKEN') ?? '';
      // 部署工作流在仓库变量没设置时传进来的是空字符串：同样用免费档默认列表
      const codes = envList(
        ctx.env,
        'FOOTBALL_DATA_COMPETITIONS',
        FOOTBALL_DATA_FREE,
        (c) => Boolean(FOOTBALL_DATA_CODES[c]),
        (c) => c.toUpperCase(),
      );
      const fixtures: RawFixture[] = [];
      const notes: string[] = [];
      // 每次最多 10 天；dateTo 不包含
      for (let t = ctx.windowStart.getTime(); t < ctx.windowEnd.getTime(); t += 10 * DAY_MS) {
        const from = isoDate(new Date(t));
        const to = isoDate(new Date(Math.min(t + 10 * DAY_MS, ctx.windowEnd.getTime() + DAY_MS)));
        const url = `${BASE}/matches?competitions=${codes.join(',')}&dateFrom=${from}&dateTo=${to}`;
        try {
          const data = await ctx.fetcher.getJson<{
            matches?: FdMatch[];
            message?: string;
            errorCode?: number;
          }>(url, {
            kind: 'api',
            headers: { 'X-Auth-Token': token },
            ttlMs: 50 * 60 * 1000,
            cacheable: hasMatches,
          });
          if (!data.matches) {
            notes.push(`football-data ${from}~${to} 失败：${data.message ?? '没有返回比赛数据'}`);
            continue;
          }
          for (const m of data.matches) {
            const f = parseFootballDataMatch(m);
            if (f) fixtures.push(f);
          }
        } catch (err) {
          notes.push(`football-data ${from}~${to} 失败：${(err as Error).message}`);
        }
      }
      ctx.log(`football-data: ${fixtures.length} 场`);
      return { fixtures, notes };
    },
  };
}
