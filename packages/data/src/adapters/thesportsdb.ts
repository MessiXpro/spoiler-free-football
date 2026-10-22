import type { AdapterContext, AdapterResult, FixtureAdapter, RawFixture } from '../types.ts';
import { envList, envValue } from '../env.ts';
import {
  isNationalCompetition,
  pair,
  stageFromTheSportsDb,
  teamRef,
  theSportsDbRoundIsMatchday,
} from '../normalize.ts';

/**
 * TheSportsDB v1：补齐 football-data 免费档没有的杯赛和国家队赛事
 * （足总杯、联赛杯、社区盾、国王杯、西超杯、欧联、欧协联、欧国联、友谊赛、预选赛、世俱杯…）。
 *
 * 不设置 THESPORTSDB_KEY 时使用官方公开的免费测试 Key "123"：
 *   - eventsnextleague / eventspastleague 只返回 1 场，用来确定当前赛季和轮次
 *   - eventsround（按轮次）能拿到整轮比赛
 * 付费 Key 用 eventsseason 一次拿整个赛季（付费 Key 调 eventsround 会返回 404）。
 * 限速：免费 30 次/分钟。
 */

const BASE = 'https://www.thesportsdb.com/api/v1/json';
export const FREE_KEY = '123';

/** TheSportsDB 联赛 id → 本项目赛事 id（id 已在官方 all_leagues 数据中核实） */
export const THESPORTSDB_LEAGUES: Record<string, string> = {
  '4480': 'ucl',
  '4481': 'uel',
  '5071': 'uecl',
  '4482': 'fa-cup',
  '4570': 'efl-cup',
  '4571': 'community-shield',
  '4483': 'copa-del-rey',
  '4511': 'supercopa',
  '4512': 'uefa-super-cup',
  '4503': 'club-world-cup',
  '5696': 'intercontinental-cup',
  '4490': 'nations-league',
  '4562': 'friendlies',
  '5518': 'wc-qualifiers',
  '5515': 'wc-qualifiers',
  '5519': 'euro-qualifiers',
  '4502': 'euro',
  '4499': 'copa-america',
  '4429': 'world-cup',
  // 联赛默认由 openfootball / football-data 提供，可通过 THESPORTSDB_LEAGUES 环境变量加入
  '4328': 'epl',
  '4335': 'laliga',
};

/**
 * 默认拉取的赛事，按重要程度排序：免费 Key 很慢，超过用时上限时排在后面的这次先不拉。
 * （不能用 Object.keys：数字形式的键会被按数值排序，上届世界杯会排在最前面）
 * 联赛默认由 openfootball / football-data 提供，可通过 THESPORTSDB_LEAGUES 环境变量加入
 */
export const DEFAULT_THESPORTSDB_LEAGUES = [
  '4480', // 欧冠
  '4481', // 欧联
  '4482', // 足总杯
  '4483', // 国王杯
  '4570', // 联赛杯
  '4490', // 欧国联
  '4562', // 友谊赛
  '5519', // 欧预赛
  '5518', // 世预赛
  '5515', // 世预赛
  '5071', // 欧协联
  '4511', // 西班牙超级杯
  '4571', // 社区盾
  '4512', // 欧洲超级杯
  '5696', // 洲际杯
  '4503', // 世俱杯
  '4429', // 世界杯
  '4502', // 欧洲杯
  '4499', // 美洲杯
];

export interface TsdbEvent {
  idEvent: string;
  strTimestamp?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  idLeague: string;
  strSeason?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  intRound?: string | null;
  strGroup?: string | null;
  strStatus?: string | null;
  strPostponed?: string | null;
}

const FINISHED = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO', 'MATCH FINISHED']);

const RECENT_TTL_MS = 3 * 60 * 60 * 1000;
const SETTLED_TTL_MS = 24 * 60 * 60 * 1000;
const SETTLED_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * 一整轮的缓存有效期：每场都已完赛、而且最后一场也是两天以前的，缓存一天；否则 3 小时
 * （还有没踢的、延期的、刚踢完可能更正比分的，都按 3 小时）
 */
export function settledRoundTtl(body: string, now = Date.now()): number {
  try {
    const events = (JSON.parse(body) as EventsResponse).events;
    if (!Array.isArray(events) || events.length === 0) return RECENT_TTL_MS;
    const settled = events.every((e) => {
      const f = parseTheSportsDbEvent(e, new Date(now));
      return Boolean(f?.finished) && now - Date.parse(f!.kickoff) > SETTLED_AFTER_MS;
    });
    return settled ? SETTLED_TTL_MS : RECENT_TTL_MS;
  } catch {
    return RECENT_TTL_MS;
  }
}
const POSTPONED = new Set(['PST', 'SUSP', 'INT', 'POSTPONED']);
const CANCELLED = new Set(['CANC', 'ABD', 'CANCELLED', 'ABANDONED']);

function seasonLabel(strSeason: string | null | undefined, kickoff: string): string {
  const s = strSeason ?? '';
  const m = s.match(/^(\d{4})-(\d{4})$/);
  if (m) return `${m[1]}-${m[2]!.slice(2)}`;
  if (/^\d{4}$/.test(s)) return s;
  return kickoff.slice(0, 4);
}

/** 末尾带时区（Z、+00:00、+0000） */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const CLOCK = /^\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?$/i;

/** 开球时间（毫秒）；解析不了返回 NaN。没写时区的按 UTC */
function kickoffOf(e: TsdbEvent): { t: number; timeTbd: boolean } {
  const ts = e.strTimestamp?.trim();
  if (ts) {
    const t = Date.parse(HAS_ZONE.test(ts) ? ts : `${ts}Z`);
    if (!Number.isNaN(t)) return { t, timeTbd: false };
  }
  const date = e.dateEvent?.trim();
  if (!date) return { t: NaN, timeTbd: false };
  // strTime 可能是空、"TBD"、"15:00:00+00:00"：认不出的按时间待定，先放 19:00 UTC 占位
  const time = (e.strTime ?? '').trim().replace(/^(\d):/, '0$1:');
  if (CLOCK.test(time)) {
    const t = Date.parse(`${date}T${time}${HAS_ZONE.test(time) ? '' : 'Z'}`);
    if (!Number.isNaN(t)) return { t, timeTbd: false };
  }
  return { t: Date.parse(`${date}T19:00:00Z`), timeTbd: true };
}

export function parseTheSportsDbEvent(e: TsdbEvent, now: Date): RawFixture | null {
  const competition = THESPORTSDB_LEAGUES[e.idLeague];
  if (!competition || !e.strHomeTeam || !e.strAwayTeam) return null;
  // 先判断能不能解析，再转 ISO：Invalid Date 调 toISOString() 会抛错，导致整个联赛后面的请求都被跳过
  const { t, timeTbd } = kickoffOf(e);
  if (Number.isNaN(t)) return null;
  const kickoff = new Date(t).toISOString();
  const status = (e.strStatus ?? '').toUpperCase();
  const scores = pair(e.intHomeScore, e.intAwayScore);
  // 旧数据没有 strStatus：开球已过且有比分视为完赛。注意 strPostponed 不可靠，以 strStatus 为准
  const finished =
    FINISHED.has(status) || (!status && Boolean(scores) && Date.parse(kickoff) < now.getTime());
  const national = isNationalCompetition(competition);
  const { stage, matchday } = stageFromTheSportsDb(e.intRound, competition);
  const fixture: RawFixture = {
    source: 'thesportsdb',
    sourceId: e.idEvent,
    competition,
    season: seasonLabel(e.strSeason, kickoff),
    stage,
    ...(matchday ? { matchday } : {}),
    kickoff,
    ...(timeTbd ? { timeTbd } : {}),
    home: teamRef(e.strHomeTeam, national),
    away: teamRef(e.strAwayTeam, national),
    status: POSTPONED.has(status) ? 'postponed' : CANCELLED.has(status) ? 'cancelled' : 'scheduled',
    finished,
  };
  const group = e.strGroup?.replace(/^Group\s+/i, '').trim();
  if (group && group.length <= 2) fixture.group = group;
  if (finished && scores) {
    fixture.score = {
      home: scores[0],
      away: scores[1],
      ...(status === 'AET' || status === 'PEN' ? { extraTime: true } : {}),
      ...(status === 'PEN' ? { note: '点球大战决出胜负（数据源未提供点球比分）' } : {}),
    };
    // 没有点球比分：合并时优先用其他来源带点球比分的记录
    if (status === 'PEN') fixture.penaltyShootout = true;
  }
  return fixture;
}

type EventsResponse = { events?: TsdbEvent[] | string | null };

const eventsOf = (r: EventsResponse): TsdbEvent[] => (Array.isArray(r.events) ? r.events : []);

/**
 * 数据源用 HTTP 200 返回的报错原话：{"Message": "..."}（Key 无效、超额）或 events 是字符串（联赛 ID 不对）。
 * 正常响应（events 是数组或 null）返回 null
 */
export function theSportsDbErrorOf(j: unknown): string | null {
  if (!j || typeof j !== 'object') return '返回内容不是 JSON 对象';
  const r = j as Record<string, unknown>;
  if ('Message' in r) return String(r.Message);
  if (typeof r.events === 'string') return r.events;
  if (r.events != null && !Array.isArray(r.events)) return 'events 字段格式不对';
  return null;
}

/** 正常响应才缓存；报错的不缓存，修好 Key 后下一次运行就能拿到数据 */
function isEventsBody(body: string): boolean {
  try {
    return theSportsDbErrorOf(JSON.parse(body)) === null;
  } catch {
    return false;
  }
}

/**
 * 根据最近一场/下一场推出需要拉取的轮次。
 * matchdayOnly：联赛/预选赛的 intRound 一直是轮次，第 16、32 轮不按杯赛编码扩展
 */
export function roundsAround(rounds: number[], matchdayOnly = false): number[] {
  const out = new Set<number>();
  for (const r of rounds) {
    out.add(r);
    if (r >= 1 && r < 100) {
      out.add(r - 1);
      out.add(r + 1);
    }
  }
  // 杯赛淘汰阶段编码：附近的阶段一起拉
  const codes = [16, 32, 64, 125, 150, 160, 200];
  for (const r of matchdayOnly ? [] : rounds) {
    const idx = codes.indexOf(r);
    if (idx >= 0) {
      if (idx > 0) out.add(codes[idx - 1]!);
      if (idx < codes.length - 1) out.add(codes[idx + 1]!);
    }
  }
  return [...out].filter((r) => r >= 0).sort((a, b) => a - b);
}

export function createTheSportsDbAdapter(): FixtureAdapter {
  return {
    id: 'thesportsdb',
    name: 'TheSportsDB',
    priority: 20,
    async fetch(ctx: AdapterContext): Promise<AdapterResult> {
      const key = envValue(ctx.env, 'THESPORTSDB_KEY') ?? FREE_KEY;
      const premium = key !== FREE_KEY && key !== '3';
      const leagues = envList(ctx.env, 'THESPORTSDB_LEAGUES', DEFAULT_THESPORTSDB_LEAGUES, (id) =>
        Boolean(THESPORTSDB_LEAGUES[id]),
      );
      const fixtures = new Map<string, RawFixture>();
      const notes: string[] = [];
      const add = (events: TsdbEvent[]) => {
        for (const e of events) {
          let f: RawFixture | null = null;
          try {
            f = parseTheSportsDbEvent(e, ctx.now);
          } catch {
            // 单场数据异常只跳过这一场，不影响同一联赛的其他比赛
          }
          if (!f) continue;
          const t = Date.parse(f.kickoff);
          if (t < ctx.windowStart.getTime() || t > ctx.windowEnd.getTime()) continue;
          fixtures.set(f.sourceId, f);
        }
      };
      const get = (path: string) =>
        ctx.fetcher.getJson<EventsResponse>(`${BASE}/${key}/${path}`, {
          kind: 'api',
          // 按轮次拉取的结果里全都踢完两天以上的，很少再变：缓存一天，省请求（免费 Key 很慢）
          ttlMs: path.startsWith('eventsround') ? settledRoundTtl : RECENT_TTL_MS,
          cacheable: isEventsBody,
        });
      // HTTP 200 的报错（Key 无效、超额、联赛 ID 不对）不能当成「这轮没有比赛」，要算这个联赛失败
      const checked = (res: EventsResponse): EventsResponse => {
        const err = theSportsDbErrorOf(res);
        if (err) throw new Error(`数据源返回报错：${err}`);
        return res;
      };

      const now = ctx.clock ?? Date.now;
      const overBudget = () => ctx.deadline !== undefined && now() > ctx.deadline;
      const skipped: string[] = [];
      for (const id of leagues) {
        // 超过用时上限：剩下的赛事这次不拉（已经拿到的照常用，下次运行有缓存会快很多）
        if (overBudget()) {
          skipped.push(THESPORTSDB_LEAGUES[id]!);
          continue;
        }
        const before = fixtures.size;
        let requests = 2;
        try {
          // 两个请求都等完再检查报错，不让一个还在排队的请求白白发出去
          const [next, past] = (
            await Promise.all([
              get(`eventsnextleague.php?id=${id}`),
              get(`eventspastleague.php?id=${id}`),
            ])
          ).map(checked);
          const seed = [...eventsOf(next!), ...eventsOf(past!)];
          add(seed);
          const seasons = [
            ...new Set(seed.map((e) => e.strSeason).filter((s): s is string => Boolean(s))),
          ];
          if (!seasons.length) continue;
          if (premium) {
            for (const s of seasons)
              add(
                eventsOf(
                  checked(await get(`eventsseason.php?id=${id}&s=${encodeURIComponent(s)}`)),
                ),
              );
            continue;
          }
          // 每场"最近一场/下一场"只拉它自己赛季的前后几轮（不把每个赛季的轮次都拉一遍）；
          // 早于时间窗一周以上的（已经结束的赛事，例如上届世界杯、8 月的社区盾）不再往外扩，省请求
          const matchdayOnly = theSportsDbRoundIsMatchday(THESPORTSDB_LEAGUES[id]!);
          const oldBefore = ctx.windowStart.getTime() - 7 * 24 * 60 * 60 * 1000;
          const roundsBySeason = new Map<string, Set<number>>();
          for (const e of seed) {
            const round = Number(e.intRound);
            if (!e.strSeason || !Number.isFinite(round)) continue;
            let parsed: RawFixture | null = null;
            try {
              parsed = parseTheSportsDbEvent(e, ctx.now);
            } catch {
              /* 解析不了的照常拉取 */
            }
            if (parsed && Date.parse(parsed.kickoff) < oldBefore) continue;
            const set = roundsBySeason.get(e.strSeason) ?? new Set<number>();
            for (const r of roundsAround([round], matchdayOnly)) set.add(r);
            roundsBySeason.set(e.strSeason, set);
          }
          for (const [s, rounds] of roundsBySeason) {
            for (const r of [...rounds].sort((a, b) => a - b)) {
              if (overBudget()) break;
              requests++;
              add(
                eventsOf(
                  checked(await get(`eventsround.php?id=${id}&r=${r}&s=${encodeURIComponent(s)}`)),
                ),
              );
            }
          }
          ctx.log(
            `thesportsdb ${THESPORTSDB_LEAGUES[id]}：${fixtures.size - before} 场，${requests} 次请求`,
          );
        } catch (err) {
          notes.push(`联赛 ${id}（${THESPORTSDB_LEAGUES[id]}）失败：${(err as Error).message}`);
        }
      }
      if (skipped.length) {
        notes.push(`超过用时上限，这次没拉取（失败）：${[...new Set(skipped)].join('、')}`);
      }
      if (!premium) notes.push('使用免费测试 Key：只拉取当前前后几轮');
      ctx.log(`thesportsdb: ${fixtures.size} 场`);
      return { fixtures: [...fixtures.values()], notes };
    },
  };
}
