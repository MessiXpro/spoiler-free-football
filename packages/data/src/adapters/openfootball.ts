import { getCompetition, type Stage } from '@sff/core';
import type { AdapterContext, AdapterResult, FixtureAdapter, RawFixture } from '../types.ts';
import { isNationalCompetition, pair, stageFromApiFootball, teamRef } from '../normalize.ts';
import { offsetTimeToUtc, seasonOf, zonedToUtc } from '../time.ts';

/**
 * openfootball：公有领域的赛程/赛果数据，托管在 GitHub（官方说明欢迎直接用 raw 链接当作 JSON API）。
 * 覆盖英超、西甲（当前赛季），以及世界杯等国家队大赛。不需要 API Key。
 * https://github.com/openfootball/football.json
 */

interface OfMatch {
  round?: string;
  group?: string;
  date: string;
  time?: string;
  team1: string;
  team2: string;
  score?: { ft?: number[]; ht?: number[]; et?: number[]; p?: number[] } | number[];
  status?: string;
}

interface OfFile {
  name?: string;
  matches?: OfMatch[];
  rounds?: Array<{ name?: string; matches: OfMatch[] }>;
}

export interface OpenfootballSource {
  competition: string;
  season: string;
  url: string;
  /** 数据里的时间是当地时间 */
  timeZone: string;
}

const RAW = 'https://raw.githubusercontent.com/openfootball';

export function defaultOpenfootballSources(now: Date): OpenfootballSource[] {
  const season = seasonOf(now);
  const sources: OpenfootballSource[] = [
    {
      competition: 'epl',
      season,
      url: `${RAW}/football.json/master/${season}/en.1.json`,
      timeZone: 'Europe/London',
    },
    {
      competition: 'laliga',
      season,
      url: `${RAW}/football.json/master/${season}/es.1.json`,
      timeZone: 'Europe/Madrid',
    },
  ];
  const year = now.getUTCFullYear();
  // 世界杯每四年一届（2026、2030…），只在当年夏天前后拉取
  if (year % 4 === 2 && now.getUTCMonth() >= 4 && now.getUTCMonth() <= 7) {
    sources.push({
      competition: 'world-cup',
      season: String(year),
      url: `${RAW}/worldcup.json/master/${year}/worldcup.json`,
      timeZone: 'UTC',
    });
  }
  return sources;
}

function stageFromLabel(
  label: string | undefined,
  competition: string,
): { stage: Stage; matchday?: number; group?: string } {
  const r = (label ?? '').trim();
  const kind = getCompetition(competition)?.kind;
  const md = Number(r.match(/^Matchday\s+(\d+)/i)?.[1]);
  if (Number.isFinite(md) && md > 0) {
    if (kind === 'league') return { stage: 'regular', matchday: md };
    if (kind === 'international') return { stage: 'group', matchday: md };
    return { stage: 'league-phase', matchday: md };
  }
  if (/third place/i.test(r)) return { stage: 'third-place' };
  return stageFromApiFootball(r);
}

export function parseOpenfootball(json: OfFile, src: OpenfootballSource): RawFixture[] {
  const all: OfMatch[] = [
    ...(json.matches ?? []),
    ...(json.rounds ?? []).flatMap((r) => r.matches.map((m) => ({ round: r.name, ...m }))),
  ];
  const national = isNationalCompetition(src.competition);
  const out: RawFixture[] = [];
  for (const m of all) {
    if (!m.date || !m.team1 || !m.team2) continue;
    const timeTbd = !m.time;
    let kickoff: string | null;
    if (m.time && /UTC/i.test(m.time)) {
      kickoff = offsetTimeToUtc(m.date, m.time);
    } else {
      // 没有开球时间的比赛先按当地 20:00 占位，页面显示"时间待定"
      kickoff = zonedToUtc(m.date, m.time ?? '20:00', src.timeZone);
    }
    if (!kickoff) continue;
    const { stage, matchday } = stageFromLabel(m.round, src.competition);
    const group = m.group?.replace(/^Group\s+/i, '') || undefined;
    const home = teamRef(m.team1, national);
    const away = teamRef(m.team2, national);

    const raw = m.score;
    const ft = Array.isArray(raw) ? raw : raw?.ft;
    const et = Array.isArray(raw) ? undefined : raw?.et;
    const pens = Array.isArray(raw) ? undefined : raw?.p;
    const ht = Array.isArray(raw) ? undefined : raw?.ht;
    const final = pair(et?.[0], et?.[1]) ?? pair(ft?.[0], ft?.[1]);
    const finished = Boolean(final);

    const fixture: RawFixture = {
      source: 'openfootball',
      sourceId: `${src.competition}:${m.date}:${m.team1}:${m.team2}`,
      competition: src.competition,
      season: src.season,
      stage,
      ...(matchday ? { matchday } : {}),
      ...(group ? { group } : {}),
      kickoff,
      ...(timeTbd ? { timeTbd } : {}),
      home,
      away,
      status: 'scheduled',
      finished,
    };
    if (final) {
      fixture.score = {
        home: final[0],
        away: final[1],
        ...(pair(ht?.[0], ht?.[1]) ? { halfTime: pair(ht?.[0], ht?.[1]) } : {}),
        ...(et ? { extraTime: true, regularTime: pair(ft?.[0], ft?.[1]) } : {}),
        ...(pair(pens?.[0], pens?.[1]) ? { penalties: pair(pens?.[0], pens?.[1]) } : {}),
      };
    }
    out.push(fixture);
  }
  return out;
}

export function createOpenfootballAdapter(
  sources?: (now: Date) => OpenfootballSource[],
): FixtureAdapter {
  return {
    id: 'openfootball',
    name: 'openfootball（公有领域赛程数据）',
    priority: 10,
    async fetch(ctx: AdapterContext): Promise<AdapterResult> {
      const fixtures: RawFixture[] = [];
      const notes: string[] = [];
      for (const src of (sources ?? defaultOpenfootballSources)(ctx.now)) {
        try {
          const json = await ctx.fetcher.getJson<OfFile>(src.url, {
            kind: 'api',
            ttlMs: 2 * 60 * 60 * 1000,
          });
          const parsed = parseOpenfootball(json, src).filter((f) => {
            const t = Date.parse(f.kickoff);
            return t >= ctx.windowStart.getTime() && t <= ctx.windowEnd.getTime();
          });
          fixtures.push(...parsed);
          ctx.log(`openfootball ${src.competition}: ${parsed.length} 场`);
        } catch (err) {
          notes.push(`${src.competition} 拉取失败：${(err as Error).message}`);
        }
      }
      return { fixtures, notes };
    },
  };
}
