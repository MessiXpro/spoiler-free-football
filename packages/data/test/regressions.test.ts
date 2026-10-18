import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_LOCK_LOOKBACK_DAYS } from '@sff/core';
import { describe, expect, it } from 'vitest';
import { createApiFootballAdapter, parseApiFootballFixture } from '../src/adapters/api-football.ts';
import {
  createFootballDataAdapter,
  parseFootballDataMatch,
  type FdMatch,
} from '../src/adapters/football-data.ts';
import { createManualAdapter, parseManual } from '../src/adapters/manual.ts';
import { parseOpenfootball } from '../src/adapters/openfootball.ts';
import {
  createTheSportsDbAdapter,
  DEFAULT_THESPORTSDB_LEAGUES,
  parseTheSportsDbEvent,
  roundsAround,
  THESPORTSDB_LEAGUES,
  type TsdbEvent,
} from '../src/adapters/thesportsdb.ts';
import { buildData, CONFIG_DIR, loadConfig } from '../src/build.ts';
import { cleanEnv, envList, envValue } from '../src/env.ts';
import { createFixtureFetcher, createHttpFetcher } from '../src/http.ts';
import { mergeFixtures } from '../src/merge.ts';
import { stageFromTheSportsDb, teamRef } from '../src/normalize.ts';
import { findPublicDataLeaks } from '../src/privacy.ts';
import { fixture, SAMPLE_DIR, SAMPLE_ENV, SAMPLE_NOW, sampleFetcher } from '../src/sample.ts';
import { sourceStatus, stepSummary } from '../src/summary.ts';
import type { AdapterContext, FixtureAdapter, RawFixture } from '../src/types.ts';

const json = <T>(path: string) => JSON.parse(fixture(path)) as T;

function ctx(partial: Partial<AdapterContext> & Pick<AdapterContext, 'fetcher'>): AdapterContext {
  return {
    now: new Date('2026-10-16T12:00:00Z'),
    env: {},
    windowStart: new Date('2020-01-01T00:00:00Z'),
    windowEnd: new Date('2030-01-01T00:00:00Z'),
    log: () => {},
    ...partial,
  };
}

function fakeFetch(handler: (url: string, n: number) => Response) {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url, calls.length);
  }) as typeof fetch;
  return { impl, calls };
}

const PRIORITY = {
  manual: 100,
  'football-data': 40,
  'api-football': 30,
  thesportsdb: 20,
  openfootball: 10,
};

const raw = (p: Partial<RawFixture>): RawFixture => ({
  source: 'football-data',
  sourceId: Math.random().toString(),
  competition: 'epl',
  season: '2026-27',
  stage: 'regular',
  kickoff: '2026-10-17T11:30:00.000Z',
  home: teamRef('Everton'),
  away: teamRef('Chelsea'),
  status: 'scheduled',
  finished: false,
  ...p,
});

describe('#11/#16 空字符串环境变量当作未设置', () => {
  it('工具函数', () => {
    expect(envValue({ A: '' }, 'A')).toBeUndefined();
    expect(envValue({ A: '  ' }, 'A')).toBeUndefined();
    expect(envValue({ A: ' x ' }, 'A')).toBe('x');
    expect(cleanEnv({ A: '', B: 'b', C: undefined })).toEqual({ B: 'b' });
    expect(envList({ L: 'xx,yy' }, 'L', ['a'], (x) => x === 'a')).toEqual(['a']);
    expect(envList({ L: ' a , b ' }, 'L', ['z'], () => true)).toEqual(['a', 'b']);
  });

  it('FOOTBALL_DATA_COMPETITIONS 为空/空白/全是不认识的代码时用免费档默认列表', async () => {
    for (const value of ['', '   ', 'XX,YY']) {
      const urls: string[] = [];
      const fetcher = createFixtureFetcher(
        [['football-data.org', () => fixture('football-data/matches-2026-10-13.json')]],
        (u) => urls.push(u),
      );
      await createFootballDataAdapter().fetch(
        ctx({
          fetcher,
          env: { FOOTBALL_DATA_TOKEN: 'x', FOOTBALL_DATA_COMPETITIONS: value },
          windowStart: new Date('2026-10-01T00:00:00Z'),
          windowEnd: new Date('2026-10-05T00:00:00Z'),
        }),
      );
      expect(urls[0], JSON.stringify(value)).toContain('competitions=PL,PD,CL,EC,WC&');
    }
    // 设置了就按设置的来
    const urls: string[] = [];
    await createFootballDataAdapter().fetch(
      ctx({
        fetcher: createFixtureFetcher([['football-data.org', () => '{"matches":[]}']], (u) =>
          urls.push(u),
        ),
        env: { FOOTBALL_DATA_TOKEN: 'x', FOOTBALL_DATA_COMPETITIONS: 'pl, fac' },
        windowStart: new Date('2026-10-01T00:00:00Z'),
        windowEnd: new Date('2026-10-05T00:00:00Z'),
      }),
    );
    expect(urls[0]).toContain('competitions=PL,FAC&');
  });

  it('THESPORTSDB_LEAGUES / APIFOOTBALL_LEAGUES 为空时用默认联赛', async () => {
    const tsdb: string[] = [];
    await createTheSportsDbAdapter().fetch(
      ctx({
        fetcher: createFixtureFetcher([['thesportsdb.com', () => '{"events":null}']], (u) =>
          tsdb.push(u),
        ),
        env: { THESPORTSDB_LEAGUES: '', THESPORTSDB_KEY: '' },
      }),
    );
    expect(tsdb.some((u) => u.includes('/json/123/eventsnextleague.php?id=4480'))).toBe(true);
    const af: string[] = [];
    await createApiFootballAdapter().fetch(
      ctx({
        fetcher: createFixtureFetcher([['api-sports.io', () => '{"response":[]}']], (u) =>
          af.push(u),
        ),
        env: { APIFOOTBALL_KEY: 'k', APIFOOTBALL_LEAGUES: '' },
      }),
    );
    expect(af.length).toBeGreaterThan(5);
    expect(af.some((u) => u.includes('league=45&'))).toBe(true);
  });

  it('示例管线按部署工作流的环境变量（没设置的都是空字符串）运行：结果和不设置一样', async () => {
    const config = await loadConfig(CONFIG_DIR, { links: join(SAMPLE_DIR, 'links.sample.json') });
    const urls: string[] = [];
    const deployEnv = {
      ...SAMPLE_ENV,
      FOOTBALL_DATA_COMPETITIONS: '',
      THESPORTSDB_KEY: '',
      APIFOOTBALL_KEY: '',
      SFF_HTTP_CACHE: '',
    };
    const out = await buildData({
      now: SAMPLE_NOW,
      fetcher: sampleFetcher((u) => urls.push(u)),
      env: deployEnv,
      config,
    });
    const ref = await buildData({
      now: SAMPLE_NOW,
      fetcher: sampleFetcher(),
      env: SAMPLE_ENV,
      config,
    });
    const fd = urls.filter((u) => u.includes('football-data.org'));
    expect(fd.length).toBeGreaterThan(0);
    for (const u of fd) expect(u).toContain('competitions=PL,PD,CL,EC,WC&');
    expect(urls.some((u) => u.includes('/json/123/'))).toBe(true);
    expect(out.matches.map((m) => m.id)).toEqual(ref.matches.map((m) => m.id));
    expect(out.meta.sources.find((s) => s.id === 'api-football')!.ok).toBe(false);
    for (const name of ['matches.json', 'programs.json', 'meta.json', 'broadcast.json']) {
      expect(findPublicDataLeaks(out.files.get(name), name)).toEqual([]);
    }
  });
});

describe('#12 缓存文件里没有 TheSportsDB 付费 Key', () => {
  const KEY = 'MY-PAID-KEY-9999';
  const url = `https://www.thesportsdb.com/api/v1/json/${KEY}/eventsnextleague.php?id=4482`;

  it('文件名和内容都不含密钥，缓存照常命中、照常带 ETag 重新验证', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sff-key-'));
    const { impl, calls } = fakeFetch((_u, n) =>
      n === 1
        ? new Response('{"events":[]}', { status: 200, headers: { etag: '"e1"' } })
        : new Response(null, { status: 304 }),
    );
    const f = createHttpFetcher({
      cacheDir: dir,
      fetchImpl: impl,
      defaultIntervalMs: 0,
      sleep: async () => {},
    });
    await f.getJson(url, { kind: 'api' });
    await f.getJson(url, { kind: 'api' });
    expect(calls).toHaveLength(1);
    expect((await f.getText(url, { kind: 'api', ttlMs: 0 })).fromCache).toBe(true);
    expect(calls).toHaveLength(2);
    const names = await readdir(dir);
    expect(names.length).toBe(1);
    for (const n of names) {
      expect(n).not.toContain(KEY);
      const content = await readFile(join(dir, n), 'utf8');
      expect(content).not.toContain(KEY);
      expect(JSON.parse(content).url).toContain('/json/***/');
    }
  });

  it('启动时删掉旧版（带明文 Key 的）缓存文件，其他文件不动', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sff-legacy-'));
    const legacy = `${'a'.repeat(32)}.json`;
    await writeFile(join(dir, legacy), JSON.stringify({ url, body: '{}' }));
    await writeFile(join(dir, 'keep.json'), '{}');
    const { impl } = fakeFetch(() => new Response('{"events":null}'));
    const f = createHttpFetcher({
      cacheDir: dir,
      fetchImpl: impl,
      defaultIntervalMs: 0,
      sleep: async () => {},
    });
    await f.getJson(url, { kind: 'api' });
    const names = await readdir(dir);
    expect(names).not.toContain(legacy);
    expect(names).toContain('keep.json');
    for (const n of names) expect(await readFile(join(dir, n), 'utf8')).not.toContain(KEY);
  });
});

describe('#17 改期超过 4 天：同一 id 只出现一次', () => {
  it('football-data 新日期 + openfootball 旧日期 → 一场，用高优先级来源的时间', () => {
    const merged = mergeFixtures(
      [
        raw({ source: 'football-data', kickoff: '2026-11-04T19:30:00.000Z' }),
        raw({ source: 'openfootball', kickoff: '2026-10-17T11:30:00.000Z' }),
      ],
      PRIORITY,
      'now',
    );
    expect(merged.map((m) => [m.match.id, m.match.kickoff])).toEqual([
      ['epl-2026-27-everton-chelsea', '2026-11-04T19:30:00.000Z'],
    ]);
    expect(merged[0]!.match.sources.sort()).toEqual(['football-data', 'openfootball']);
  });

  it('高优先级来源时间待定时，不会退回旧日期的确切时间', () => {
    const merged = mergeFixtures(
      [
        raw({ source: 'football-data', kickoff: '2026-11-04T00:00:00.000Z', timeTbd: true }),
        raw({ source: 'openfootball', kickoff: '2026-10-17T11:30:00.000Z' }),
      ],
      PRIORITY,
      'now',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.match.kickoff).toBe('2026-11-04T00:00:00.000Z');
    expect(merged[0]!.match.timeTbd).toBe(true);
  });

  it('延期 + 另一来源的新日期 → 一场；旧日期来源的比分不会挂到新日期上', () => {
    const merged = mergeFixtures(
      [
        raw({
          source: 'football-data',
          competition: 'laliga',
          home: teamRef('Rayo Vallecano'),
          away: teamRef('Athletic Club'),
          kickoff: '2026-12-02T20:00:00.000Z',
        }),
        raw({
          source: 'openfootball',
          competition: 'laliga',
          home: teamRef('Rayo Vallecano'),
          away: teamRef('Athletic Club'),
          kickoff: '2026-10-10T12:00:00.000Z',
          finished: true,
          score: { home: 1, away: 0 },
        }),
      ],
      PRIORITY,
      'now',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.match.kickoff).toBe('2026-12-02T20:00:00.000Z');
    expect(merged[0]!.score).toBeUndefined();
  });

  it('友谊赛 id 带日期，不同日期的两场仍是两场', () => {
    const merged = mergeFixtures(
      [
        raw({
          competition: 'friendlies',
          stage: 'friendly',
          home: teamRef('England', true),
          away: teamRef('Brazil', true),
          kickoff: '2026-11-14T20:00:00.000Z',
        }),
        raw({
          competition: 'friendlies',
          stage: 'friendly',
          home: teamRef('England', true),
          away: teamRef('Brazil', true),
          kickoff: '2027-03-26T20:00:00.000Z',
        }),
      ],
      PRIORITY,
      'now',
    );
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((m) => m.match.id)).size).toBe(2);
  });
});

describe('#18 含点球大战进球的比分', () => {
  const edge = json<{ matches: FdMatch[] }>('football-data/edgecases.json');
  const wc = parseOpenfootball(json('openfootball/worldcup-2026.subset.json'), {
    competition: 'world-cup',
    season: '2026',
    url: '',
    timeZone: 'UTC',
  });

  it('合并时用 openfootball 的正确比分（1-1 加时，点球 3-4），不用 football-data 的 4-5', () => {
    const fd = parseFootballDataMatch(edge.matches.find((m) => m.id === 537415)!)!;
    expect(fd.scoreIncludesShootout).toBe(true);
    const merged = mergeFixtures([fd, ...wc], PRIORITY, 'now');
    const ger = merged.find((m) => m.match.home.id === 'nt-germany')!;
    expect(ger.match.sources.sort()).toEqual(['football-data', 'openfootball']);
    expect(ger.score).toMatchObject({
      home: 1,
      away: 1,
      extraTime: true,
      penalties: [3, 4],
      source: 'openfootball',
    });
    expect(ger.score?.note).toBeUndefined();
    // 内部标记不写进比分文件
    expect(JSON.stringify(ger.score)).not.toContain('scoreIncludesShootout');
  });

  it('只有含点球进球的比分时照常给出（带说明）', () => {
    const fd = parseFootballDataMatch(edge.matches.find((m) => m.id === 537415)!)!;
    const merged = mergeFixtures([fd], PRIORITY, 'now');
    expect(merged[0]!.score).toMatchObject({ home: 4, away: 5 });
    expect(merged[0]!.score?.note).toMatch(/点球/);
  });

  const leg = (p: Partial<RawFixture>) =>
    raw({
      competition: 'ucl',
      stage: 'round-of-16',
      home: teamRef('Arsenal'),
      away: teamRef('PSV'),
      kickoff: '2027-03-10T20:00:00.000Z',
      finished: true,
      score: { home: 1, away: 1 },
      ...p,
    });

  it('次回合比分含点球进球时不算总比分（不会出现 6-5）', () => {
    const second = parseFootballDataMatch({
      id: 9,
      utcDate: '2027-03-17T20:00:00Z',
      status: 'FINISHED',
      matchday: null,
      stage: 'LAST_16',
      group: null,
      competition: { id: 2001, code: 'CL', name: 'UEFA Champions League' },
      season: { startDate: '2026-09-01' },
      homeTeam: { id: 1, name: 'PSV' },
      awayTeam: { id: 2, name: 'Arsenal' },
      score: { duration: 'PENALTY_SHOOTOUT', fullTime: { home: 5, away: 4 } },
    })!;
    const merged = mergeFixtures([leg({}), second], PRIORITY, 'now');
    expect(merged.map((m) => m.match.leg)).toEqual([1, 2]);
    expect(merged[1]!.score?.aggregate).toBeUndefined();
    // 点球比分齐全时照常计算
    const ok = mergeFixtures(
      [
        leg({}),
        leg({
          home: teamRef('PSV'),
          away: teamRef('Arsenal'),
          kickoff: '2027-03-17T20:00:00.000Z',
          score: { home: 1, away: 1, extraTime: true, penalties: [4, 3] },
        }),
      ],
      PRIORITY,
      'now',
    );
    expect(ok[1]!.score?.aggregate).toEqual([2, 2]);
  });
});

describe('#18 点球大战决胜但没给点球比分的记录排在完整比分后面', () => {
  const edge = json<{ matches: FdMatch[] }>('football-data/edgecases.json');
  const fd = () => parseFootballDataMatch(edge.matches.find((m) => m.id === 537415)!)!;
  const wc = () =>
    parseOpenfootball(json('openfootball/worldcup-2026.subset.json'), {
      competition: 'world-cup',
      season: '2026',
      url: '',
      timeZone: 'UTC',
    });
  // 默认就拉的 TheSportsDB 世界杯（联赛 4429）：状态 PEN，只有 1-1，没有点球比分
  const tsdb = () =>
    parseTheSportsDbEvent(
      {
        idEvent: '99001',
        idLeague: '4429',
        strSeason: '2026',
        strTimestamp: '2026-06-29T20:30:00',
        strHomeTeam: 'Germany',
        strAwayTeam: 'Paraguay',
        intHomeScore: '1',
        intAwayScore: '1',
        intRound: '32',
        strStatus: 'PEN',
      },
      new Date('2026-07-01T00:00:00Z'),
    )!;

  it('football-data（含点球进球）+ TheSportsDB（无点球比分）+ openfootball（完整）→ 用 openfootball 的', () => {
    expect(tsdb().penaltyShootout).toBe(true);
    expect(tsdb().score?.penalties).toBeUndefined();
    const merged = mergeFixtures([fd(), tsdb(), ...wc()], PRIORITY, 'now');
    const ger = merged.filter((m) => m.match.home.id === 'nt-germany');
    expect(ger).toHaveLength(1);
    expect(ger[0]!.match.id).toBe('world-cup-2026-round-of-32-nt-germany-nt-paraguay');
    expect(ger[0]!.match.sources.sort()).toEqual(['football-data', 'openfootball', 'thesportsdb']);
    expect(ger[0]!.score).toMatchObject({
      home: 1,
      away: 1,
      extraTime: true,
      regularTime: [1, 1],
      penalties: [3, 4],
      source: 'openfootball',
    });
    expect(ger[0]!.score?.note).toBeUndefined();
  });

  it('没有完整比分时：正确的加时比分（无点球）排在含点球进球的总比分前面', () => {
    const merged = mergeFixtures([fd(), tsdb()], PRIORITY, 'now');
    expect(merged[0]!.score).toMatchObject({ home: 1, away: 1, source: 'thesportsdb' });
    expect(merged[0]!.score?.note).toMatch(/点球/);
  });

  it('只有一个来源说是点球决胜时，其他来源没有点球比分的记录也算不完整', () => {
    // API-Football 状态 PEN 但没给 penalty：同样标记
    const af = parseApiFootballFixture({
      fixture: { id: 1, date: '2026-06-29T20:30:00+00:00', status: { short: 'PEN' } },
      league: { id: 1, season: 2026, round: 'Round of 32' },
      teams: { home: { name: 'Germany' }, away: { name: 'Paraguay' } },
      goals: { home: 1, away: 1 },
    })!;
    expect(af.penaltyShootout).toBe(true);
    const merged = mergeFixtures([af, ...wc()], PRIORITY, 'now');
    const ger = merged.find((m) => m.match.home.id === 'nt-germany')!;
    expect(ger.score).toMatchObject({ penalties: [3, 4], source: 'openfootball' });
    // 都没说是点球决胜时，照常按优先级
    const plain = mergeFixtures(
      [
        raw({ source: 'football-data', finished: true, score: { home: 2, away: 1 } }),
        raw({
          source: 'openfootball',
          finished: true,
          score: { home: 2, away: 1, halfTime: [1, 0] },
        }),
      ],
      PRIORITY,
      'now',
    );
    expect(plain[0]!.score?.source).toBe('football-data');
  });
});

describe('#17/#46 旧日期在拉取窗口内（60 天）时改期的比赛不消失', () => {
  const NOW = new Date('2026-11-10T06:00:00Z');
  const adapter = (id: string, priority: number, fixtures: RawFixture[]): FixtureAdapter => ({
    id,
    name: id,
    priority,
    // 跟真实数据源一样只返回时间窗内的比赛
    fetch: async (c) => ({
      fixtures: fixtures.filter((f) => {
        const t = Date.parse(f.kickoff);
        return t >= c.windowStart.getTime() && t <= c.windowEnd.getTime();
      }),
      notes: [],
    }),
  });
  const build = async (adapters: FixtureAdapter[]) => {
    const out = await buildData({
      now: NOW,
      fetcher: createFixtureFetcher([]),
      env: {},
      config: await loadConfig(),
      adapters,
    });
    return out.matches.map((m) => [m.id, m.kickoff, m.status]);
  };
  const NEW_DATE = raw({ source: 'openfootball', kickoff: '2026-11-25T20:00:00.000Z' });

  it('football-data 在 21 天前的旧日期报延期，openfootball 已是新日期 → 按新日期公开', async () => {
    const old = raw({ kickoff: '2026-10-10T12:00:00.000Z', status: 'postponed' });
    expect(
      await build([adapter('football-data', 40, [old]), adapter('openfootball', 10, [NEW_DATE])]),
    ).toEqual([['epl-2026-27-everton-chelsea', '2026-11-25T20:00:00.000Z', 'scheduled']]);
  });

  it('TheSportsDB 停在旧日期（未完赛），openfootball 已是新日期 → 按新日期公开', async () => {
    const stale = raw({ source: 'thesportsdb', kickoff: '2026-10-10T12:00:00.000Z' });
    expect(
      await build([adapter('thesportsdb', 20, [stale]), adapter('openfootball', 10, [NEW_DATE])]),
    ).toEqual([['epl-2026-27-everton-chelsea', '2026-11-25T20:00:00.000Z', 'scheduled']]);
  });

  it('公开窗口内的延期旧日期也换成新日期，不再只显示"延期"', () => {
    const merged = mergeFixtures(
      [raw({ kickoff: '2026-11-01T15:00:00.000Z', status: 'postponed' }), NEW_DATE],
      PRIORITY,
      NOW.toISOString(),
      NOW,
    );
    expect(merged.map((m) => [m.match.kickoff, m.match.status])).toEqual([
      ['2026-11-25T20:00:00.000Z', 'scheduled'],
    ]);
    expect(merged[0]!.match.sources.sort()).toEqual(['football-data', 'openfootball']);
  });

  it('其他情况仍以优先级高的来源为准', () => {
    const merge = (fixtures: RawFixture[]) =>
      mergeFixtures(fixtures, PRIORITY, NOW.toISOString(), NOW).map((m) => [
        m.match.kickoff,
        m.match.status,
        m.score?.source,
      ]);
    // 旧日期已完赛：比赛就是那天踢的
    expect(
      merge([
        raw({ kickoff: '2026-10-10T12:00:00.000Z', finished: true, score: { home: 1, away: 0 } }),
        NEW_DATE,
      ]),
    ).toEqual([['2026-10-10T12:00:00.000Z', 'scheduled', 'football-data']]);
    // 正在进行（开球不到一天）
    expect(merge([raw({ kickoff: '2026-11-10T05:00:00.000Z' }), NEW_DATE])).toEqual([
      ['2026-11-10T05:00:00.000Z', 'scheduled', undefined],
    ]);
    // 另一个日期更早（不会往前挪）
    expect(
      merge([
        raw({ kickoff: '2026-11-20T15:00:00.000Z', status: 'postponed' }),
        raw({ source: 'openfootball', kickoff: '2026-11-12T15:00:00.000Z' }),
      ]),
    ).toEqual([['2026-11-20T15:00:00.000Z', 'postponed', undefined]]);
    // 没有其他日期
    expect(merge([raw({ kickoff: '2026-10-10T12:00:00.000Z', status: 'postponed' })])).toEqual([
      ['2026-10-10T12:00:00.000Z', 'postponed', undefined],
    ]);
  });
});

describe('#19 手工改期条目只覆盖开球时间', () => {
  const minimal = (competition: string, kickoff: string, home: string, away: string) =>
    parseManual({ matches: [{ competition, kickoff, home, away }] });

  it('没写的赛季/阶段/状态留空', () => {
    const [m] = minimal('epl', '2026-10-18T15:30:00+01:00', 'Everton', 'Chelsea');
    expect(m!.season).toBeUndefined();
    expect(m!.stage).toBeUndefined();
    expect(m!.status).toBeUndefined();
    expect(minimal('friendlies', '2026-11-14T20:00:00Z', '英格兰', 'Brazil')[0]!.stage).toBe(
      'friendly',
    );
  });

  it('英超改期：id 不变，开球时间用手工的', () => {
    const merged = mergeFixtures(
      [
        raw({ source: 'openfootball' }),
        raw({ source: 'football-data', matchday: 8 }),
        ...minimal('epl', '2026-10-18T15:30:00+01:00', 'Everton', 'Chelsea'),
      ],
      PRIORITY,
      'now',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.match).toMatchObject({
      id: 'epl-2026-27-everton-chelsea',
      season: '2026-27',
      stage: 'regular',
      matchday: 8,
      kickoff: '2026-10-18T14:30:00.000Z',
      status: 'scheduled',
    });
  });

  it('其他来源报告延期时不被手工条目盖掉', () => {
    const merged = mergeFixtures(
      [
        raw({ source: 'football-data', status: 'postponed' }),
        ...minimal('epl', '2026-10-18T15:30:00+01:00', 'Everton', 'Chelsea'),
      ],
      PRIORITY,
      'now',
    );
    expect(merged[0]!.match.status).toBe('postponed');
  });

  it('足总杯 1/4 决赛改期后仍是淘汰赛（对阵继续锁定），赛季不变', () => {
    const qf = raw({
      source: 'thesportsdb',
      competition: 'fa-cup',
      stage: 'quarter-final',
      home: teamRef('Arsenal'),
      away: teamRef('Chelsea'),
      kickoff: '2027-03-20T15:00:00.000Z',
    });
    const merged = mergeFixtures(
      [qf, ...minimal('fa-cup', '2027-03-21T16:30:00+00:00', 'Arsenal', 'Chelsea')],
      PRIORITY,
      'now',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.match).toMatchObject({
      id: 'fa-cup-2026-27-quarter-final-arsenal-chelsea',
      season: '2026-27',
      stage: 'quarter-final',
      kickoff: '2027-03-21T16:30:00.000Z',
    });
  });

  it('只有手工条目时：俱乐部赛事赛季按 "2026-27"，国家队按年份', () => {
    const club = mergeFixtures(
      minimal('fa-cup', '2027-03-21T16:30:00+00:00', 'Arsenal', 'Chelsea'),
      PRIORITY,
      'now',
    );
    expect(club[0]!.match.season).toBe('2026-27');
    expect(club[0]!.match.status).toBe('scheduled');
    const nt = mergeFixtures(
      minimal('friendlies', '2026-11-14T20:00:00Z', 'England', 'Brazil'),
      PRIORITY,
      'now',
    );
    expect(nt[0]!.match.season).toBe('2026');
    expect(nt[0]!.match.id).toBe('friendlies-2026-11-14-nt-england-nt-brazil');
  });
});

describe('#42 TheSportsDB 联赛第 16/32 轮', () => {
  it('联赛、预选赛按轮次；杯赛/大赛仍按淘汰阶段编码', () => {
    expect(stageFromTheSportsDb('16', 'epl')).toEqual({ stage: 'regular', matchday: 16 });
    expect(stageFromTheSportsDb('32', 'laliga')).toEqual({ stage: 'regular', matchday: 32 });
    expect(stageFromTheSportsDb('16', 'wc-qualifiers')).toEqual({ stage: 'group', matchday: 16 });
    expect(stageFromTheSportsDb('16', 'fa-cup').stage).toBe('round-of-16');
    expect(stageFromTheSportsDb('32', 'world-cup').stage).toBe('round-of-32');
    expect(stageFromTheSportsDb('500', 'epl').stage).toBe('friendly');
  });

  it('真实英超事件改成第 16 轮：常规赛第 16 轮', () => {
    const round = json<{ events: TsdbEvent[] }>(
      'thesportsdb/eventsround-4328-r1-2026-2027-freekey.json',
    );
    const f = parseTheSportsDbEvent({ ...round.events[0]!, intRound: '16' }, SAMPLE_NOW)!;
    expect(f.stage).toBe('regular');
    expect(f.matchday).toBe(16);
  });

  it('联赛不按杯赛编码扩展轮次', () => {
    expect(roundsAround([16], true)).toEqual([15, 16, 17]);
    expect(roundsAround([16])).toEqual([15, 16, 17, 32]);
  });

  it('adapter 拉英超第 16 轮时不请求第 32 轮', async () => {
    const next = json<{ events: TsdbEvent[] }>('thesportsdb/eventsnextleague-4328-freekey.json');
    const urls: string[] = [];
    const fetcher = createFixtureFetcher(
      [
        [
          'eventsnextleague',
          () => JSON.stringify({ events: [{ ...next.events[0]!, intRound: '16' }] }),
        ],
        ['eventspastleague', () => '{"events":null}'],
        ['eventsround', () => '{"events":null}'],
      ],
      (u) => urls.push(u),
    );
    await createTheSportsDbAdapter().fetch(ctx({ fetcher, env: { THESPORTSDB_LEAGUES: '4328' } }));
    const rounds = urls
      .filter((u) => u.includes('eventsround'))
      .map((u) => Number(new URL(u).searchParams.get('r')));
    expect(rounds.sort((a, b) => a - b)).toEqual([15, 16, 17]);
  });
});

describe('#43 HTTP 200 的报错内容不缓存', () => {
  const fetcherWith = async (handler: (url: string, n: number) => Response) => {
    const dir = await mkdtemp(join(tmpdir(), 'sff-err-'));
    const fake = fakeFetch(handler);
    const make = () =>
      createHttpFetcher({
        cacheDir: dir,
        fetchImpl: fake.impl,
        defaultIntervalMs: 0,
        sleep: async () => {},
      });
    return { make, calls: fake.calls };
  };

  it('API-Football：Key 错误的响应不缓存，修好后下一次运行就能拿到数据', async () => {
    const good = JSON.parse(fixture('api-football/fixtures-bl1.json')) as {
      response: Array<{ league: Record<string, unknown> }>;
    };
    const asCup = {
      response: good.response.map((f) => ({ ...f, league: { ...f.league, id: 45 } })),
    };
    const { make, calls } = await fetcherWith((_u, n) =>
      n === 1
        ? new Response(JSON.stringify({ errors: { token: 'Error/Missing application key' } }))
        : new Response(JSON.stringify(asCup)),
    );
    const c = ctx({ fetcher: make(), env: { APIFOOTBALL_KEY: 'bad', APIFOOTBALL_LEAGUES: '45' } });
    const first = await createApiFootballAdapter().fetch(c);
    expect(first.fixtures).toEqual([]);
    expect(first.notes[0]).toMatch(/application key/);
    // 下一次运行（新的 fetcher，同一个缓存目录，仍在 5 小时有效期内）
    const second = await createApiFootballAdapter().fetch({
      ...c,
      fetcher: make(),
      env: { APIFOOTBALL_KEY: 'fixed', APIFOOTBALL_LEAGUES: '45' },
    });
    expect(second.fixtures.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });

  it('TheSportsDB：{"Message": ...} 不缓存', async () => {
    const { make, calls } = await fetcherWith(
      () => new Response('{"Message":"Invalid Premium API key"}'),
    );
    const url = 'https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=4482';
    const c = ctx({ fetcher: make(), env: { THESPORTSDB_LEAGUES: '4482' } });
    await createTheSportsDbAdapter().fetch(c);
    await createTheSportsDbAdapter().fetch({ ...c, fetcher: make() });
    expect(calls.filter((u) => u === url)).toHaveLength(2);
  });

  it('报错内容且有旧缓存时用旧缓存；不是 JSON 的响应也不缓存', async () => {
    const { make, calls } = await fetcherWith((_u, n) =>
      n === 1 ? new Response('{"events":[]}') : new Response('{"Message":"limit"}'),
    );
    const f = make();
    const url = 'https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id=1&r=1&s=2026-2027';
    const cacheable = (b: string) => !b.includes('Message');
    expect(await f.getJson(url, { kind: 'api', cacheable })).toEqual({ events: [] });
    const res = await f.getText(url, { kind: 'api', ttlMs: 0, cacheable });
    expect(res).toMatchObject({ body: '{"events":[]}', fromCache: true });
    expect(calls).toHaveLength(2);

    const bad = await fetcherWith(() => new Response('<html>oops</html>'));
    const g = bad.make();
    await expect(g.getJson('https://api.example.com/x', { kind: 'api' })).rejects.toThrow();
    await expect(g.getJson('https://api.example.com/x', { kind: 'api' })).rejects.toThrow();
    expect(bad.calls).toHaveLength(2);
  });
});

describe('#44 重试后仍是 429/5xx 时用旧缓存', () => {
  it('503 → 返回缓存', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sff-5xx-'));
    const { impl, calls } = fakeFetch((_u, n) =>
      n === 1 ? new Response('{"matches":[1]}') : new Response('down', { status: 503 }),
    );
    const f = createHttpFetcher({
      cacheDir: dir,
      fetchImpl: impl,
      defaultIntervalMs: 0,
      sleep: async () => {},
    });
    const url = 'https://raw.githubusercontent.com/x.json';
    expect(await f.getJson(url, { kind: 'api' })).toEqual({ matches: [1] });
    const res = await f.getText(url, { kind: 'api', ttlMs: 0 });
    expect(res).toMatchObject({ body: '{"matches":[1]}', fromCache: true });
    expect(calls.length).toBe(4);
    // 没有缓存时照常报错
    await expect(
      f.getText('https://raw.githubusercontent.com/other.json', { kind: 'api' }),
    ).rejects.toThrow(/503/);
  });
});

describe('#45 TheSportsDB 时间格式异常', () => {
  const round = json<{ events: TsdbEvent[] }>(
    'thesportsdb/eventsround-4328-r1-2026-2027-freekey.json',
  );
  const base = round.events[0]!;

  it('带时区的时间戳、带时区/TBD 的 strTime 都不抛错', () => {
    const now = new Date('2026-10-16T00:00:00Z');
    const a = parseTheSportsDbEvent({ ...base, strTimestamp: '2026-10-10T11:30:00+00:00' }, now)!;
    expect(a.kickoff).toBe('2026-10-10T11:30:00.000Z');
    const b = parseTheSportsDbEvent(
      { ...base, strTimestamp: null, dateEvent: '2026-10-10', strTime: '15:00:00+00:00' },
      now,
    )!;
    expect(b.kickoff).toBe('2026-10-10T15:00:00.000Z');
    expect(b.timeTbd).toBeUndefined();
    const c = parseTheSportsDbEvent(
      { ...base, strTimestamp: null, dateEvent: '2026-10-10', strTime: 'TBD' },
      now,
    )!;
    expect(c.kickoff).toBe('2026-10-10T19:00:00.000Z');
    expect(c.timeTbd).toBe(true);
    const d = parseTheSportsDbEvent(
      { ...base, strTimestamp: 'garbage', dateEvent: '2026-10-10', strTime: '12:00:00' },
      now,
    )!;
    expect(d.kickoff).toBe('2026-10-10T12:00:00.000Z');
    expect(
      parseTheSportsDbEvent({ ...base, strTimestamp: 'garbage', dateEvent: null }, now),
    ).toBeNull();
  });

  it('一场时间异常不影响同一联赛其他比赛', async () => {
    const broken = {
      events: round.events.map((e, i) =>
        i === 3 ? { ...e, strTimestamp: null, strTime: 'TBD' } : e,
      ),
    };
    const run = (roundBody: string) =>
      createTheSportsDbAdapter().fetch(
        ctx({
          fetcher: createFixtureFetcher([
            ['eventsnextleague', () => fixture('thesportsdb/eventsnextleague-4328-freekey.json')],
            ['eventspastleague', () => fixture('thesportsdb/eventspastleague-4328-freekey.json')],
            ['eventsround', () => roundBody],
          ]),
          env: { THESPORTSDB_LEAGUES: '4328' },
        }),
      );
    const ok = await run(fixture('thesportsdb/eventsround-4328-r1-2026-2027-freekey.json'));
    const res = await run(JSON.stringify(broken));
    expect(res.fixtures).toHaveLength(ok.fixtures.length);
    expect(res.notes.some((n) => /失败/.test(n))).toBe(false);
  });
});

describe('#46 两回合间隔超过 21 天', () => {
  const legs: RawFixture[] = [
    raw({
      source: 'api-football',
      competition: 'efl-cup',
      stage: 'semi-final',
      home: teamRef('Arsenal'),
      away: teamRef('Newcastle'),
      kickoff: '2027-01-06T20:00:00.000Z',
      finished: true,
      score: { home: 0, away: 2 },
    }),
    raw({
      source: 'api-football',
      competition: 'efl-cup',
      stage: 'semi-final',
      home: teamRef('Newcastle'),
      away: teamRef('Arsenal'),
      kickoff: '2027-02-04T20:00:00.000Z',
      finished: true,
      score: { home: 0, away: 2 },
    }),
  ];
  // 跟真实数据源一样只返回时间窗内的比赛
  const windowed: FixtureAdapter = {
    id: 'api-football',
    name: 'API-Football',
    priority: 30,
    fetch: async (c) => ({
      fixtures: legs.filter((f) => {
        const t = Date.parse(f.kickoff);
        return t >= c.windowStart.getTime() && t <= c.windowEnd.getTime();
      }),
      notes: [],
    }),
  };

  it('次回合仍标"次回合"并有总比分；首回合不公开', async () => {
    const config = await loadConfig();
    const now = new Date('2027-02-05T06:00:00Z');
    const out = await buildData({
      now,
      fetcher: createFixtureFetcher([]),
      env: {},
      config,
      adapters: [windowed],
      // 公开窗口比两回合间隔短时（默认窗口是 60 天，这里手动设成 21 天）
      pastDays: 21,
    });
    expect(out.matches.map((m) => [m.id, m.leg])).toEqual([
      ['efl-cup-2026-27-semi-final-newcastle-arsenal', 2],
    ]);
    const score = out.files.get('scores/efl-cup-2026-27-semi-final-newcastle-arsenal.json') as {
      aggregate?: [number, number];
    };
    expect(score.aggregate).toEqual([2, 2]);
    expect(out.files.has('scores/efl-cup-2026-27-semi-final-arsenal-newcastle.json')).toBe(false);
    expect(out.meta.windowStart).toBe(new Date(now.getTime() - 21 * 86400000).toISOString());
    // 关于页显示的场数只数公开的
    expect(out.meta.sources[0]!.count).toBe(1);
  });
});

describe('#47 目录外球队名里有结果词时不让构建失败', () => {
  it('由队名生成的 id 不查结果词', () => {
    expect(
      findPublicDataLeaks(
        {
          matches: [
            {
              id: 'club-world-cup-2029-real-madrid-x-melbourne-victory',
              home: { id: 'real-madrid', name: '皇马' },
              away: { id: 'x-melbourne-victory', name: 'Melbourne Victory' },
            },
            {
              id: 'friendlies-2026-11-14-x-doxa-drama-nt-brazil',
              home: { id: 'x-doxa-drama', name: 'Doxa Drama' },
              away: { id: 'nt-brazil', name: '巴西' },
            },
          ],
        },
        'matches.json',
      ),
    ).toEqual([]);
  });

  it('但 id 和队名里的数字比分仍会被拦下', () => {
    const leaks = findPublicDataLeaks(
      {
        matches: [
          {
            id: 'epl-2026-27-x-arsenal-2-1-chelsea',
            home: { id: 'x-arsenal-2-1', name: 'Arsenal 2-1' },
            away: { id: 'chelsea', name: '切尔西 1：0' },
          },
        ],
      },
      'matches.json',
    );
    expect(leaks).toHaveLength(4);
  });

  it('管线：世俱杯目录外球队 Melbourne Victory 不导致构建失败', async () => {
    const config = await loadConfig();
    const manual = createManualAdapter({
      matches: [
        {
          competition: 'club-world-cup',
          season: '2029',
          stage: 'group',
          kickoff: '2029-06-15T19:00:00+00:00',
          home: 'Real Madrid',
          away: 'Melbourne Victory',
        },
      ],
    });
    const out = await buildData({
      now: new Date('2029-06-10T00:00:00Z'),
      fetcher: createFixtureFetcher([]),
      env: {},
      config,
      adapters: [manual],
    });
    expect(out.matches.map((m) => m.id)).toEqual([
      'club-world-cup-2029-real-madrid-x-melbourne-victory',
    ]);
    expect(out.matches[0]!.away).toEqual({
      id: 'x-melbourne-victory',
      name: 'Melbourne Victory',
    });
  });
});

describe('#48 并发请求也按域名限速', () => {
  it('Promise.all 的两个请求错开发出', async () => {
    const waits: number[] = [];
    const { impl } = fakeFetch(() => new Response('{}'));
    const f = createHttpFetcher({
      fetchImpl: impl,
      minIntervalMs: { 'www.thesportsdb.com': 500 },
      sleep: async (ms) => {
        waits.push(ms);
        await Promise.resolve();
      },
    });
    const u = (p: string) => `https://www.thesportsdb.com/api/v1/json/123/${p}`;
    await f.getText(u('a'), { kind: 'api' });
    await Promise.all([f.getText(u('b'), { kind: 'api' }), f.getText(u('c'), { kind: 'api' })]);
    await f.getText(u('d'), { kind: 'api' });
    waits.sort((a, b) => a - b);
    expect(waits).toHaveLength(3);
    expect(waits[0]).toBeGreaterThan(400);
    expect(waits[1]).toBeGreaterThan(900);
    expect(waits[2]).toBeGreaterThan(1400);
  });
});

describe('#46 公开窗口覆盖淘汰赛锁定往前看的天数', () => {
  it('默认公开 60 天内的已结束比赛（锁定后一轮对阵要用到）', async () => {
    const now = new Date('2026-11-10T06:00:00Z');
    const out = await buildData({
      now,
      fetcher: createFixtureFetcher([]),
      env: {},
      config: await loadConfig(),
      adapters: [],
    });
    expect(out.meta.windowStart).toBe(
      new Date(now.getTime() - FIXTURE_LOCK_LOOKBACK_DAYS * 86400000).toISOString(),
    );
  });
});

describe('维护者诊断：目录外球队、可能重复的比赛', () => {
  const NOW = new Date('2026-11-10T06:00:00Z');
  const fixed = (id: string, priority: number, fixtures: RawFixture[]): FixtureAdapter => ({
    id,
    name: id,
    priority,
    fetch: async () => ({ fixtures, notes: [] }),
  });

  it('列出目录里没有的球队；同一支球队 3 小时内出现两场（主客写反）记为可能重复', async () => {
    const kickoff = '2026-11-08T15:00:00.000Z';
    const out = await buildData({
      now: NOW,
      fetcher: createFixtureFetcher([]),
      env: {},
      config: await loadConfig(),
      adapters: [
        fixed('football-data', 40, [
          raw({
            source: 'football-data',
            competition: 'fa-cup',
            home: teamRef('Arsenal'),
            away: teamRef('Boreham Wood'),
            kickoff,
          }),
        ]),
        fixed('thesportsdb', 20, [
          raw({
            source: 'thesportsdb',
            competition: 'fa-cup',
            home: teamRef('Boreham Wood FC'),
            away: teamRef('Arsenal'),
            kickoff,
          }),
        ]),
      ],
    });
    expect(out.diagnostics.unknownTeams).toHaveLength(2);
    expect(out.diagnostics.unknownTeams).toEqual(
      expect.arrayContaining([
        { source: 'football-data', competition: 'fa-cup', name: 'Boreham Wood' },
        { source: 'thesportsdb', competition: 'fa-cup', name: 'Boreham Wood FC' },
      ]),
    );
    expect(out.diagnostics.possibleDuplicates).toHaveLength(1);
    expect(out.diagnostics.possibleDuplicates[0]!.competition).toBe('fa-cup');
    // 诊断信息不写进公开数据
    expect(JSON.stringify([...out.files.values()])).not.toContain('possibleDuplicates');
  });

  it('正常数据没有可能重复的比赛', async () => {
    const out = await buildData({
      now: SAMPLE_NOW,
      fetcher: sampleFetcher(),
      env: SAMPLE_ENV,
      config: await loadConfig(CONFIG_DIR, { links: join(SAMPLE_DIR, 'links.sample.json') }),
    });
    expect(out.diagnostics.possibleDuplicates).toEqual([]);
  });
});

describe('诊断和运行页小结不暴露淘汰赛对阵', () => {
  const NOW = new Date('2026-11-10T06:00:00Z');
  const kickoff = '2026-11-08T15:00:00.000Z';
  const fixed = (id: string, priority: number, fixtures: RawFixture[]): FixtureAdapter => ({
    id,
    name: id,
    priority,
    fetch: async () => ({ fixtures, notes: [] }),
  });
  const knockout = (source: string, home: string, away: string) =>
    raw({
      source,
      competition: 'fa-cup',
      stage: 'round-of-32',
      home: teamRef(home),
      away: teamRef(away),
      kickoff,
    });

  it('淘汰赛的目录外球队只计数；可能重复的淘汰赛不写队名', async () => {
    const out = await buildData({
      now: NOW,
      fetcher: createFixtureFetcher([]),
      env: {},
      config: await loadConfig(),
      adapters: [
        fixed('football-data', 40, [knockout('football-data', 'Arsenal', 'Boreham Wood')]),
        fixed('thesportsdb', 20, [knockout('thesportsdb', 'Boreham Wood FC', 'Arsenal')]),
      ],
    });
    expect(out.diagnostics.unknownTeams).toEqual([]);
    expect(out.diagnostics.hiddenKnockoutTeams).toBe(2);
    expect(out.diagnostics.possibleDuplicates).toHaveLength(1);
    const summary = stepSummary(out, 0);
    for (const name of ['Boreham', '阿森纳', 'Arsenal', 'arsenal', 'boreham']) {
      expect(summary).not.toContain(name);
      expect(JSON.stringify(out.diagnostics)).not.toContain(name);
    }
    expect(summary).toContain('队名已隐藏');
    expect(summary).toContain('2 个目录外的球队名');
  });

  it('请求全部失败、或一场都没拿到的数据源显示 ⚠️，不显示 ✅', () => {
    expect(
      sourceStatus({
        ok: true,
        count: 0,
        note: 'football-data 2026-11-01~2026-11-10 失败：HTTP 403',
      }),
    ).toBe('warn');
    expect(sourceStatus({ ok: true, count: 12, note: 'API-Football 联赛 39 失败：quota' })).toBe(
      'warn',
    );
    expect(sourceStatus({ ok: true, count: 0, note: '使用免费测试 Key：只拉取当前前后几轮' })).toBe(
      'warn',
    );
    expect(
      sourceStatus({ ok: true, count: 30, note: '使用免费测试 Key：只拉取当前前后几轮' }),
    ).toBe('ok');
    expect(sourceStatus({ ok: false, count: 0, note: '未设置 KEY，跳过' })).toBe('off');
    expect(sourceStatus({ id: 'manual', ok: true, count: 0 })).toBe('ok');
  });

  it('football-data / API-Football 返回错误信息时，说明里带"失败"', async () => {
    const res = await createFootballDataAdapter().fetch(
      ctx({
        env: { FOOTBALL_DATA_TOKEN: 't' },
        windowStart: new Date('2026-11-01T00:00:00Z'),
        windowEnd: new Date('2026-11-05T00:00:00Z'),
        fetcher: createFixtureFetcher([
          [
            'api.football-data.org',
            () => JSON.stringify({ message: 'restricted', errorCode: 403 }),
          ],
        ]),
      }),
    );
    expect(res.notes.length).toBeGreaterThan(0);
    expect(res.notes.every((n) => /失败/.test(n))).toBe(true);
  });
});

describe('TheSportsDB 免费 Key 少发请求', () => {
  const event = (p: Record<string, string>) => ({
    idEvent: p.idEvent ?? '1',
    idLeague: '4429',
    strLeague: 'FIFA World Cup',
    strHomeTeam: 'Spain',
    strAwayTeam: 'France',
    strStatus: 'FT',
    ...p,
  });
  const run = async (next: unknown[], past: unknown[], now: Date) => {
    const urls: string[] = [];
    await createTheSportsDbAdapter().fetch(
      ctx({
        now,
        windowStart: new Date(now.getTime() - 60 * 86400000),
        windowEnd: new Date(now.getTime() + 30 * 86400000),
        env: { THESPORTSDB_LEAGUES: '4429' },
        fetcher: createFixtureFetcher(
          [
            ['eventsnextleague', () => JSON.stringify({ events: next.length ? next : null })],
            ['eventspastleague', () => JSON.stringify({ events: past })],
            ['eventsround', () => JSON.stringify({ events: null })],
          ],
          (u) => urls.push(u),
        ),
      }),
    );
    return urls.filter((u) => u.includes('eventsround')).map((u) => new URL(u).search);
  };

  it('已经结束很久的赛事（只有早于时间窗的最近一场）不再按轮次拉取', async () => {
    const final = event({
      strSeason: '2026',
      intRound: '200',
      dateEvent: '2026-07-19',
      strTimestamp: '2026-07-19T19:00:00',
    });
    expect(await run([], [final], new Date('2026-10-18T06:00:00Z'))).toEqual([]);
  });

  it('最近一场和下一场在不同赛季：各自只拉自己赛季的前后几轮', async () => {
    const past = event({
      strSeason: '2025-2026',
      intRound: '5',
      dateEvent: '2026-10-01',
      strTimestamp: '2026-10-01T19:00:00',
    });
    const next = event({
      idEvent: '2',
      strSeason: '2026-2027',
      intRound: '1',
      strStatus: 'NS',
      dateEvent: '2026-10-25',
      strTimestamp: '2026-10-25T19:00:00',
    });
    const rounds = await run([next], [past], new Date('2026-10-18T06:00:00Z'));
    expect(rounds.filter((q) => q.includes('s=2025-2026')).length).toBeGreaterThan(0);
    expect(rounds.filter((q) => q.includes('s=2026-2027')).length).toBeGreaterThan(0);
    // 两个赛季各 3 轮左右，而不是 2 × 6 轮
    expect(rounds.length).toBeLessThanOrEqual(6);
    expect(rounds.some((q) => q.includes('s=2026-2027') && q.includes('r=5&'))).toBe(false);
  });
});

describe('数据源用时上限', () => {
  it('TheSportsDB 超过用时上限：剩下的赛事不拉，已经拿到的照常用，说明里写明', async () => {
    let t = 0;
    const urls: string[] = [];
    const res = await createTheSportsDbAdapter().fetch(
      ctx({
        env: { THESPORTSDB_LEAGUES: '4328,4482,4570' },
        clock: () => t,
        deadline: 1000,
        fetcher: createFixtureFetcher(
          [
            ['eventsnextleague', () => fixture('thesportsdb/eventsnextleague-4328-freekey.json')],
            ['eventspastleague', () => fixture('thesportsdb/eventspastleague-4328-freekey.json')],
            [
              'eventsround',
              () => fixture('thesportsdb/eventsround-4328-r1-2026-2027-freekey.json'),
            ],
          ],
          (u) => {
            urls.push(u);
            t += 400; // 每次请求 0.4 秒
          },
        ),
      }),
    );
    expect(res.fixtures.length).toBeGreaterThan(0);
    expect(res.notes.join()).toMatch(/超过用时上限.*失败.*fa-cup.*efl-cup/);
    expect(urls.some((u) => u.includes('id=4482'))).toBe(false);
    expect(sourceStatus({ ok: true, count: res.fixtures.length, note: res.notes.join('；') })).toBe(
      'warn',
    );
  });
});

describe('真实数据试跑里目录外的球队名（2026-10）', () => {
  it.each([
    ['N.Ireland', true, 'nt-northern-ireland'],
    ['LASK', false, 'lask'],
    ['Sabah Baku', false, 'sabah'],
    ['Sabah FK', false, 'sabah'],
    ['Viking', false, 'viking'],
    ['Ararat-Armenia', false, 'ararat-armenia'],
    ['Celje', false, 'celje'],
    ["Hapoel Be'er Sheva", false, 'hapoel-beer-sheva'],
    ['Jagiellonia Białystok', false, 'jagiellonia'],
    ['Lech Poznań', false, 'lech-poznan'],
    ['Levski Sofia', false, 'levski-sofia'],
    ['Lillestrøm', false, 'lillestrom'],
    ['NEC Nijmegen', false, 'nec'],
    ['OFI', false, 'ofi'],
    ['Omonia Nicosia', false, 'omonia'],
    ['Torreense', false, 'torreense'],
  ] as const)('%s → %s', (name, national, id) => {
    expect(teamRef(name, national).id).toBe(id);
  });
});

describe('TheSportsDB 默认赛事顺序', () => {
  it('覆盖除英超、西甲外的全部赛事，重要的排在前面', () => {
    expect(new Set(DEFAULT_THESPORTSDB_LEAGUES)).toEqual(
      new Set(Object.keys(THESPORTSDB_LEAGUES).filter((id) => id !== '4328' && id !== '4335')),
    );
    expect(DEFAULT_THESPORTSDB_LEAGUES.length).toBe(Object.keys(THESPORTSDB_LEAGUES).length - 2);
    expect(DEFAULT_THESPORTSDB_LEAGUES.slice(0, 2)).toEqual(['4480', '4481']);
    expect(DEFAULT_THESPORTSDB_LEAGUES.indexOf('4429')).toBeGreaterThan(
      DEFAULT_THESPORTSDB_LEAGUES.indexOf('4570'),
    );
  });
});
