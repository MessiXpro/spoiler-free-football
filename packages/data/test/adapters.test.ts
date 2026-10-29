import { describe, expect, it } from 'vitest';
import {
  createOpenfootballAdapter,
  defaultOpenfootballSources,
  parseOpenfootball,
} from '../src/adapters/openfootball.ts';
import {
  parseFootballDataMatch,
  type FdMatch,
  createFootballDataAdapter,
} from '../src/adapters/football-data.ts';
import {
  parseTheSportsDbEvent,
  roundsAround,
  createTheSportsDbAdapter,
  type TsdbEvent,
} from '../src/adapters/thesportsdb.ts';
import {
  parseApiFootballFixture,
  type AfFixture,
  createApiFootballAdapter,
} from '../src/adapters/api-football.ts';
import { parseManual } from '../src/adapters/manual.ts';
import { createFixtureFetcher } from '../src/http.ts';
import { fixture } from '../src/sample.ts';
import type { AdapterContext } from '../src/types.ts';

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

describe('openfootball adapter（真实 2026-27 英超/西甲数据）', () => {
  const epl = parseOpenfootball(json('openfootball/en.1-2026-27.json'), {
    competition: 'epl',
    season: '2026-27',
    url: '',
    timeZone: 'Europe/London',
  });
  const laliga = parseOpenfootball(json('openfootball/es.1-2026-27.json'), {
    competition: 'laliga',
    season: '2026-27',
    url: '',
    timeZone: 'Europe/Madrid',
  });

  it('解析出整个赛季 380 场，20 支球队全部对上目录', () => {
    expect(epl).toHaveLength(380);
    expect(laliga).toHaveLength(380);
    const unknown = [...epl, ...laliga]
      .flatMap((f) => [f.home, f.away])
      .filter((t) => t.id.startsWith('x-'));
    expect(unknown).toEqual([]);
  });

  it('当地时间正确换算成 UTC（英国夏令时/冬令时、西班牙）', () => {
    const opener = epl.find((f) => f.home.id === 'arsenal' && f.away.id === 'coventry')!;
    expect(opener.kickoff).toBe('2026-08-21T19:00:00.000Z'); // 20:00 BST
    const evt = epl.find((f) => f.home.id === 'everton' && f.away.id === 'chelsea')!;
    expect(evt.kickoff).toBe('2026-10-17T11:30:00.000Z'); // 12:30 BST，与 football-data 一致
    const derby = laliga.find((f) => f.home.id === 'atletico' && f.away.id === 'real-madrid')!;
    expect(derby.kickoff).toBe('2026-09-20T14:15:00.000Z'); // 16:15 CEST
    const winter = epl.find((f) => f.kickoff.startsWith('2026-12-'));
    expect(winter?.kickoff.slice(11, 16)).toMatch(/^(12|14|15|17|19|20):\d\d$/);
  });

  it('没有开球时间的比赛标为时间待定', () => {
    expect(laliga.some((f) => f.timeTbd)).toBe(true);
  });

  it('只把已赛比赛的比分放进 score 字段，并标记 finished', () => {
    const played = epl.filter((f) => f.finished);
    expect(played.length).toBeGreaterThan(0);
    for (const f of played) expect(typeof f.score?.home).toBe('number');
    expect(epl.filter((f) => !f.finished).every((f) => !f.score)).toBe(true);
    expect(epl[0]!.matchday).toBe(1);
  });

  it('世界杯：加时、点球大战、带时区的开球时间', () => {
    const wc = parseOpenfootball(json('openfootball/worldcup-2026.subset.json'), {
      competition: 'world-cup',
      season: '2026',
      url: '',
      timeZone: 'UTC',
    });
    expect(wc).toHaveLength(3);
    const ger = wc.find((f) => f.home.id === 'nt-germany')!;
    expect(ger.kickoff).toBe('2026-06-29T20:30:00.000Z');
    expect(ger.stage).toBe('round-of-32');
    expect(ger.score?.extraTime).toBe(true);
    expect(ger.score?.penalties).toHaveLength(2);
    expect(wc[0]!.stage).toBe('group');
    expect(wc[0]!.group).toBe('A');
  });

  it('adapter 只请求 raw.githubusercontent.com', async () => {
    const urls: string[] = [];
    const fetcher = createFixtureFetcher(
      [
        ['en.1.json', () => fixture('openfootball/en.1-2026-27.json')],
        ['es.1.json', () => fixture('openfootball/es.1-2026-27.json')],
      ],
      (u) => urls.push(u),
    );
    const res = await createOpenfootballAdapter().fetch(ctx({ fetcher }));
    expect(res.fixtures).toHaveLength(760);
    expect(urls.every((u) => u.startsWith('https://raw.githubusercontent.com/openfootball/'))).toBe(
      true,
    );
  });
});

describe('football-data adapter（真实响应样本）', () => {
  const sample = json<{ matches: FdMatch[] }>('football-data/matches-2026-10-13.json');

  it('只保留目录里的赛事，状态和阶段正确', () => {
    const parsed = sample.matches.map(parseFootballDataMatch).filter(Boolean);
    const comps = new Set(parsed.map((f) => f!.competition));
    expect([...comps].sort()).toEqual(['epl', 'laliga', 'ucl']);
    const lens = parsed.find((f) => f!.sourceId === '575341')!;
    expect(lens.stage).toBe('league-phase');
    expect(lens.matchday).toBe(2);
    expect(lens.finished).toBe(true);
    expect(lens.home.id).toBe('lens');
    expect(lens.away.id).toBe('sporting');
    const evt = parsed.find((f) => f!.home.id === 'everton')!;
    expect(evt.kickoff).toBe('2026-10-17T11:30:00.000Z');
    expect(evt.finished).toBe(false);
    expect(evt.score).toBeUndefined();
  });

  it('点球大战：fullTime 含点球进球时不当作常规比分', () => {
    const edge = json<{ matches: FdMatch[] }>('football-data/edgecases.json');
    const ger = parseFootballDataMatch(edge.matches.find((m) => m.id === 537415)!)!;
    expect(ger.competition).toBe('world-cup');
    expect(ger.stage).toBe('round-of-32');
    // 免费档只给了含点球进球的 4-5：算不出真实比分，这一条不给比分（不发布偏大的错比分）
    expect(ger.finished).toBe(true);
    expect(ger.score).toBeUndefined();
    expect(ger.penaltyShootout).toBe(true);
    // 给了 90 分钟比分和加时进球：两者相加就是加时结束时的比分，不带说明
    const withEt = parseFootballDataMatch({
      ...edge.matches.find((m) => m.id === 537415)!,
      score: {
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 4, away: 5 },
        halfTime: { home: 0, away: 1 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 0, away: 0 },
      },
    })!;
    expect(withEt.score).toEqual({
      home: 1,
      away: 1,
      halfTime: [0, 1],
      extraTime: true,
      regularTime: [1, 1],
    });
    expect(withEt.scoreIncludesShootout).toBeUndefined();
    // 仍然没有点球比分：合并时排在带点球比分的来源后面
    expect(withEt.penaltyShootout).toBe(true);
    // 补上点球比分后能算出加时结束时的比分
    const withPens = parseFootballDataMatch({
      ...edge.matches.find((m) => m.id === 537415)!,
      score: {
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 4, away: 5 },
        penalties: { home: 3, away: 4 },
      },
    })!;
    expect([withPens.score?.home, withPens.score?.away]).toEqual([1, 1]);
    expect(withPens.score?.penalties).toEqual([3, 4]);
  });

  it('取消的比赛不生成比分（即使数据源给了 0-0）', () => {
    const edge = json<{ matches: FdMatch[] }>('football-data/edgecases.json');
    const rayo = parseFootballDataMatch(edge.matches.find((m) => m.competition.code === 'PD')!)!;
    expect(rayo.status).toBe('cancelled');
    expect(rayo.score).toBeUndefined();
  });

  it('官方文档的完整比赛对象也能解析', () => {
    const doc = json<FdMatch>('football-data/match-330299.docs.json');
    const f = parseFootballDataMatch(doc);
    // 文档示例是德甲，不在订阅目录里，应当被忽略
    expect(f).toBeNull();
  });

  it('按固定的 10 天网格分段请求（起点不随当天滚动，缓存才用得上）；没有 Token 时不可用', async () => {
    const adapter = createFootballDataAdapter();
    expect(adapter.unavailableReason?.({})).toMatch(/FOOTBALL_DATA_TOKEN/);
    const urls: string[] = [];
    const fetcher = createFixtureFetcher(
      [['football-data.org', () => fixture('football-data/matches-2026-10-13.json')]],
      (u) => urls.push(u),
    );
    await adapter.fetch(
      ctx({
        fetcher,
        env: { FOOTBALL_DATA_TOKEN: 'x' },
        windowStart: new Date('2026-10-01T00:00:00Z'),
        windowEnd: new Date('2026-10-25T00:00:00Z'),
      }),
    );
    // 2026-10-01 所在的网格从 09-24 开始：09-24、10-04、10-14、10-24（最后一段到 windowEnd 后一天）
    expect(urls).toHaveLength(4);
    expect(urls[0]).toContain('competitions=PL,PD,CL,EC,WC');
    expect(urls[0]).toContain('dateFrom=2026-09-24&dateTo=2026-10-04');
    expect(urls[3]).toContain('dateFrom=2026-10-24&dateTo=2026-10-26');
    // 两天后再跑：起点一样，前几段的地址不变，断网/限流时才有旧缓存可用
    const later: string[] = [];
    await adapter.fetch(
      ctx({
        fetcher: createFixtureFetcher([['football-data.org', () => '{"matches":[]}']], (u) =>
          later.push(u),
        ),
        env: { FOOTBALL_DATA_TOKEN: 'x' },
        windowStart: new Date('2026-10-03T00:00:00Z'),
        windowEnd: new Date('2026-10-27T00:00:00Z'),
      }),
    );
    expect(later.slice(0, 3)).toEqual(urls.slice(0, 3));
  });
});

describe('TheSportsDB adapter（真实免费 Key 响应）', () => {
  const round = json<{ events: TsdbEvent[] }>(
    'thesportsdb/eventsround-4328-r1-2026-2027-freekey.json',
  );
  const edge = json<{ events: TsdbEvent[] }>(
    'thesportsdb/eventsday-2026-10-04-edgecases.subset.json',
  );
  const now = new Date('2026-10-16T00:00:00Z');

  it('英超第 1 轮：时间是 UTC、比分进 score、描述等字段不保留', () => {
    const parsed = round.events.map((e) => parseTheSportsDbEvent(e, now)).filter(Boolean);
    expect(parsed).toHaveLength(10);
    const ars = parsed.find((f) => f!.home.id === 'arsenal')!;
    expect(ars.kickoff).toBe('2026-08-21T19:00:00.000Z');
    expect(ars.competition).toBe('epl');
    expect(ars.season).toBe('2026-27');
    expect(ars.matchday).toBe(1);
    expect(ars.finished).toBe(true);
    expect(JSON.stringify(ars)).not.toMatch(/Reigning|strDescription|strVideo|strThumb/);
  });

  it('国王杯延期、点球、友谊赛取消等边界情况', () => {
    const parsed = edge.events.map((e) => parseTheSportsDbEvent(e, now)).filter(Boolean);
    const comps = new Set(parsed.map((f) => f!.competition));
    expect(comps.has('copa-del-rey')).toBe(true);
    for (const e of edge.events) {
      const f = parseTheSportsDbEvent(e, now);
      if (!f) continue;
      const st = (e.strStatus ?? '').toUpperCase();
      if (st === 'PST') expect(f.status).toBe('postponed');
      if (st === 'CANC') expect(f.status).toBe('cancelled');
      if (st === 'PEN') {
        expect(f.score?.extraTime).toBe(true);
        expect(f.score?.note).toMatch(/点球/);
      }
      if (e.idLeague === '4562') expect(f.stage).toBe('friendly');
    }
  });

  it('错误/空响应不报错', async () => {
    const shapes = json<Record<string, unknown>>('thesportsdb/error-and-empty-shapes.json');
    const values = Object.values(shapes).map((v) => JSON.stringify(v));
    let i = 0;
    const fetcher = createFixtureFetcher([['thesportsdb.com', () => values[i++ % values.length]!]]);
    const res = await createTheSportsDbAdapter().fetch(
      ctx({ fetcher, env: { THESPORTSDB_LEAGUES: '4482' } }),
    );
    expect(res.fixtures).toEqual([]);
  });

  it('免费 Key：用最近一场/下一场推出要拉的轮次', async () => {
    const urls: string[] = [];
    const fetcher = createFixtureFetcher(
      [
        ['eventsnextleague', () => fixture('thesportsdb/eventsnextleague-4328-freekey.json')],
        ['eventspastleague', () => fixture('thesportsdb/eventspastleague-4328-freekey.json')],
        ['eventsround', () => fixture('thesportsdb/eventsround-4328-r1-2026-2027-freekey.json')],
      ],
      (u) => urls.push(u),
    );
    const res = await createTheSportsDbAdapter().fetch(
      ctx({ fetcher, env: { THESPORTSDB_LEAGUES: '4328' } }),
    );
    expect(urls.some((u) => u.includes('/json/123/eventsround.php?id=4328'))).toBe(true);
    expect(res.fixtures.length).toBeGreaterThanOrEqual(10);
    expect(roundsAround([7])).toEqual([6, 7, 8]);
    expect(roundsAround([150])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 16, 32, 64, 125, 150, 160, 170, 200,
    ]);
  });

  it('付费 Key 用 eventsseason', async () => {
    const urls: string[] = [];
    const fetcher = createFixtureFetcher(
      [
        ['eventsnextleague', () => fixture('thesportsdb/eventsnextleague-4328-freekey.json')],
        ['eventspastleague', () => fixture('thesportsdb/eventspastleague-4328-freekey.json')],
        ['eventsseason', () => fixture('thesportsdb/eventsseason-4328-2026-2027-freekey.json')],
      ],
      (u) => urls.push(u),
    );
    await createTheSportsDbAdapter().fetch(
      ctx({ fetcher, env: { THESPORTSDB_KEY: 'premium', THESPORTSDB_LEAGUES: '4328' } }),
    );
    expect(urls.some((u) => u.includes('/json/premium/eventsseason.php?id=4328&s=2026-2027'))).toBe(
      true,
    );
    expect(urls.some((u) => u.includes('eventsround'))).toBe(false);
  });
});

describe('API-Football adapter（真实响应结构）', () => {
  it('解析 fixtures 响应；目录外联赛被忽略', () => {
    const data = json<{ response: AfFixture[] }>('api-football/fixtures-bl1.json');
    // 德甲不在本项目赛事目录里
    expect(data.response.map(parseApiFootballFixture).filter(Boolean)).toEqual([]);
    const asCup = data.response.map((f) =>
      parseApiFootballFixture({ ...f, league: { ...f.league, id: 45 } }),
    );
    expect(asCup.every((f) => f?.competition === 'fa-cup')).toBe(true);
    expect(asCup[0]!.finished).toBe(true);
    expect(asCup[0]!.home.id).toBe('frankfurt');
  });

  it('加时/点球比分拆分', () => {
    const f = parseApiFootballFixture({
      fixture: { id: 1, date: '2026-10-28T19:45:00+00:00', status: { short: 'PEN' } },
      league: { id: 48, season: 2026, round: 'Round of 16' },
      teams: { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } },
      goals: { home: 1, away: 1 },
      score: { fulltime: { home: 1, away: 1 }, penalty: { home: 4, away: 3 } },
    })!;
    expect(f.competition).toBe('efl-cup');
    expect(f.stage).toBe('round-of-16');
    expect(f.score?.extraTime).toBe(true);
    expect(f.score?.penalties).toEqual([4, 3]);
  });

  it('官方文档示例（直播中）不当作完赛', () => {
    const doc = json<{ response: AfFixture[] }>('api-football/fixtures-live.docs.json');
    for (const fx of doc.response) {
      const f = parseApiFootballFixture({ ...fx, league: { ...fx.league, id: 39 } });
      expect(f?.finished).toBe(false);
      expect(f?.score).toBeUndefined();
    }
  });

  it('没有 Key 时跳过；接口返回 errors 时记录说明', async () => {
    const adapter = createApiFootballAdapter();
    expect(adapter.unavailableReason?.({})).toMatch(/APIFOOTBALL_KEY/);
    const fetcher = createFixtureFetcher([
      [
        'api-sports.io',
        () =>
          JSON.stringify({
            errors: { plan: 'Free plans do not have access to this season' },
            response: [],
          }),
      ],
    ]);
    const res = await adapter.fetch(
      ctx({ fetcher, env: { APIFOOTBALL_KEY: 'k', APIFOOTBALL_LEAGUES: '45' } }),
    );
    expect(res.fixtures).toEqual([]);
    expect(res.notes[0]).toMatch(/Free plans/);
  });
});

describe('手工补充', () => {
  it('中英文队名都能识别，必须带时区', () => {
    const out = parseManual({
      matches: [
        {
          competition: 'friendlies',
          kickoff: '2026-11-14T20:00:00+00:00',
          home: '英格兰',
          away: 'Brazil',
        },
        { competition: 'friendlies', kickoff: 'not a date', home: 'a', away: 'b' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.home.id).toBe('nt-england');
    expect(out[0]!.away.id).toBe('nt-brazil');
    expect(out[0]!.stage).toBe('friendly');
  });
});

describe('openfootball 赛季刚切换时退回上赛季文件', () => {
  it('7～9 月：新赛季文件 404 就用上赛季的，说明里不带「失败」；其他月份照常报失败', async () => {
    const july = new Date('2026-07-15T12:00:00Z');
    const srcs = defaultOpenfootballSources(july);
    expect(srcs[0]!.season).toBe('2026-27');
    expect(srcs[0]!.fallback).toMatchObject({ season: '2025-26' });
    expect(
      defaultOpenfootballSources(new Date('2026-11-15T12:00:00Z'))[0]!.fallback,
    ).toBeUndefined();

    const urls: string[] = [];
    const res = await createOpenfootballAdapter().fetch(
      ctx({
        now: july,
        // 只有上赛季的文件存在（fixture 内容无所谓，只要能解析）
        fetcher: createFixtureFetcher(
          [
            ['2025-26/en.1.json', () => fixture('openfootball/en.1-2026-27.json')],
            ['2025-26/es.1.json', () => fixture('openfootball/es.1-2026-27.json')],
            // 2026 年 7 月世界杯数据源也在拉取范围内
            ['2026/worldcup.json', () => fixture('openfootball/worldcup-2026.subset.json')],
          ],
          (u) => urls.push(u),
        ),
        windowStart: new Date('2020-01-01T00:00:00Z'),
        windowEnd: new Date('2030-01-01T00:00:00Z'),
      }),
    );
    expect(urls.filter((u) => u.includes('2026-27'))).toHaveLength(2);
    expect(urls.filter((u) => u.includes('2025-26'))).toHaveLength(2);
    expect(res.fixtures.length).toBeGreaterThan(0);
    expect(
      res.fixtures
        .filter((f) => f.competition !== 'world-cup')
        .every((f) => f.season === '2025-26'),
    ).toBe(true);
    expect(res.notes.join('；')).toMatch(/还没发布 2026-27 赛季文件/);
    expect(res.notes.join('；')).not.toMatch(/失败/);

    // 11 月的 404 是真故障
    const nov = await createOpenfootballAdapter().fetch(
      ctx({ now: new Date('2026-11-15T12:00:00Z'), fetcher: createFixtureFetcher([]) }),
    );
    expect(nov.notes.join('；')).toMatch(/拉取失败/);
  });
});
