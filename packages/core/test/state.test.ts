import { describe, expect, it } from 'vitest';
import {
  decodeSyncCode,
  defaultUserState,
  encodeSyncCode,
  findTeam,
  formatKickoff,
  hasSpoiler,
  isFixtureLocked,
  isSubscribed,
  liveStatus,
  matchesInWindow,
  mergeUserState,
  neutralTitle,
  nightWindow,
  programLockReasons,
  sanitizeUserState,
  stageLabel,
  syncLink,
  unwatchedRecent,
  upcomingMatches,
  SyncCodeError,
  TEAMS,
  DEFAULT_TEAMS,
  type Program,
  type PublicMatch,
  canShowAggregate,
  firstLegOf,
  isShown,
  lockBlockers,
} from '../src/index.ts';

function match(partial: Partial<PublicMatch> & Pick<PublicMatch, 'id' | 'kickoff'>): PublicMatch {
  return {
    competition: 'epl',
    season: '2026-27',
    stage: 'regular',
    matchday: 7,
    home: { id: 'arsenal', name: 'Arsenal' },
    away: { id: 'chelsea', name: 'Chelsea' },
    status: 'scheduled',
    links: [],
    sources: ['test'],
    ...partial,
  };
}

describe('目录', () => {
  it('覆盖英超、西甲 2026-27 全部球队和默认国家队', () => {
    expect(TEAMS.filter((t) => t.group === 'epl')).toHaveLength(20);
    expect(TEAMS.filter((t) => t.group === 'laliga')).toHaveLength(20);
    for (const id of DEFAULT_TEAMS)
      expect(
        TEAMS.some((t) => t.id === id),
        id,
      ).toBe(true);
  });

  it('不同数据源的写法都能对上', () => {
    expect(findTeam('Arsenal FC')?.id).toBe('arsenal');
    expect(findTeam('Manchester United FC')?.id).toBe('man-utd');
    expect(findTeam('Man Utd')?.id).toBe('man-utd');
    expect(findTeam('Club Atlético de Madrid')?.id).toBe('atletico');
    expect(findTeam('Atletico Madrid')?.id).toBe('atletico');
    expect(findTeam('Real Madrid CF')?.id).toBe('real-madrid');
    expect(findTeam('Brighton & Hove Albion FC')?.id).toBe('brighton');
    expect(findTeam("Nott'm Forest")?.id).toBe('nottingham-forest');
    expect(findTeam('RC Deportivo La Coruña')?.id).toBe('deportivo');
    expect(findTeam('Real Racing Club de Santander')?.id).toBe('racing');
    expect(findTeam('Wolverhampton Wanderers')?.id).toBe('wolves');
    expect(findTeam('Spain', true)?.id).toBe('nt-spain');
    expect(findTeam('Korea Republic', true)?.id).toBe('nt-korea');
    expect(findTeam("Côte d'Ivoire", true)?.id).toBe('nt-ivory-coast');
    expect(findTeam('Some Unknown Town FC')).toBeUndefined();
  });

  it('所有球队和赛事的中文名本身不被当作剧透', () => {
    for (const t of TEAMS) {
      expect(hasSpoiler(t.zh, { football: true }), t.zh).toBe(false);
      expect(hasSpoiler(t.en, { football: true }), t.en).toBe(false);
    }
  });
});

describe('中性标题与时间', () => {
  it('统一格式：主队 vs 客队 · 赛事 · 轮次 · 开球时间（北京时间）', () => {
    const m = match({ id: 'a', kickoff: '2026-10-17T11:30:00Z' });
    expect(neutralTitle(m)).toBe('阿森纳 vs 切尔西 · 英超 · 第7轮 · 10月17日 周六 19:30');
    expect(hasSpoiler(neutralTitle(m))).toBe(false);
  });

  it('淘汰赛和两回合', () => {
    expect(stageLabel({ stage: 'round-of-16', leg: 2 })).toBe('1/8决赛 次回合');
    expect(stageLabel({ stage: 'league-phase', matchday: 3 })).toBe('联赛阶段 第3轮');
    expect(stageLabel({ stage: 'group', group: 'A', matchday: 2 })).toBe('小组赛A组 第2轮');
    expect(stageLabel({ stage: 'final' })).toBe('决赛');
  });

  it('跨日：英国周六 20:00 = 北京时间周日 03:00', () => {
    expect(formatKickoff('2026-10-17T19:00:00Z')).toBe('10月18日 周日 03:00');
    expect(formatKickoff('2026-10-17T19:00:00Z', true)).toBe('10月18日 周日 时间待定');
  });

  it('状态只看开球时间，不暴露加时', () => {
    const m = match({ id: 'a', kickoff: '2026-10-17T19:00:00Z' });
    expect(liveStatus(m, new Date('2026-10-17T18:00:00Z'))).toBe('upcoming');
    expect(liveStatus(m, new Date('2026-10-17T20:50:00Z'))).toBe('live');
    expect(liveStatus(m, new Date('2026-10-17T21:59:00Z'))).toBe('live');
    expect(liveStatus(m, new Date('2026-10-17T22:00:00Z'))).toBe('finished');
    expect(liveStatus({ ...m, status: 'postponed' }, new Date())).toBe('postponed');
  });
});

describe('订阅与视图', () => {
  const state = defaultUserState(0);
  const matches = [
    match({ id: 'evt-che', kickoff: '2026-10-17T11:30:00Z', home: { id: 'everton', name: '' } }),
    match({
      id: 'ful-hul',
      kickoff: '2026-10-17T14:00:00Z',
      home: { id: 'fulham', name: '' },
      away: { id: 'hull', name: '' },
    }),
    match({
      id: 'ars-bou',
      kickoff: '2026-10-17T19:00:00Z',
      away: { id: 'bournemouth', name: '' },
    }),
    match({
      id: 'rma-bar',
      competition: 'laliga',
      kickoff: '2026-10-25T15:15:00Z',
      home: { id: 'real-madrid', name: '' },
      away: { id: 'barcelona', name: '' },
    }),
  ];

  it('默认只显示订阅球队的比赛', () => {
    expect(isSubscribed(matches[0]!, state)).toBe(true);
    expect(isSubscribed(matches[1]!, state)).toBe(false);
    expect(isSubscribed(matches[1]!, { ...state, competitions: { epl: 'all' } })).toBe(true);
    expect(isSubscribed(matches[0]!, { ...state, competitions: { epl: 'off' } })).toBe(false);
    expect(isSubscribed(matches[0]!, { ...state, teams: [] })).toBe(false);
  });

  it('昨夜今晨：北京时间前一天 12:00 到当天 12:00，按开球时间排序', () => {
    const now = new Date('2026-10-18T00:30:00Z'); // 北京时间 10/18 08:30
    const w = nightWindow(now);
    expect(new Date(w.start).toISOString()).toBe('2026-10-17T04:00:00.000Z');
    expect(new Date(w.end).toISOString()).toBe('2026-10-18T04:00:00.000Z');
    expect(matchesInWindow(matches, state, w).map((m) => m.id)).toEqual(['evt-che', 'ars-bou']);
    expect(nightWindow(now, -1).date).toBe('2026-10-17');
  });

  it('未看完与即将开始', () => {
    const now = new Date('2026-10-18T02:00:00Z');
    expect(unwatchedRecent(matches, state, now).map((m) => m.id)).toEqual(['evt-che', 'ars-bou']);
    expect(
      unwatchedRecent(matches, state, new Date('2026-10-17T20:00:00Z')).map((m) => m.id),
    ).toEqual(['evt-che']);
    const watched = { ...state, watched: { 'evt-che': 1, 'ars-bou': 1 } };
    expect(unwatchedRecent(matches, watched, now)).toEqual([]);
    expect(upcomingMatches(matches, state, now, 10).map((m) => m.id)).toEqual(['rma-bar']);
  });

  it('淘汰赛对阵：前一轮订阅比赛没看完就锁定队名', () => {
    const qf = match({
      id: 'qf',
      competition: 'ucl',
      stage: 'quarter-final',
      leg: 1,
      kickoff: '2027-04-06T19:00:00Z',
      home: { id: 'arsenal', name: '' },
      away: { id: 'bayern', name: '' },
    });
    const r16 = match({
      id: 'r16',
      competition: 'ucl',
      stage: 'round-of-16',
      leg: 2,
      kickoff: '2027-03-17T20:00:00Z',
      home: { id: 'arsenal', name: '' },
      away: { id: 'psv', name: '' },
    });
    const qf2 = { ...qf, id: 'qf2', leg: 2 as const, kickoff: '2027-04-14T19:00:00Z' };
    const all = [r16, qf, qf2];
    const now = new Date('2027-03-20T00:00:00Z');
    expect(isFixtureLocked(qf, all, state, now)).toBe(true);
    expect(isFixtureLocked(qf, all, { ...state, watched: { r16: 1 } }, now)).toBe(false);
    expect(isFixtureLocked(qf, all, { ...state, unlocked: { 'fixture:qf': 1 } }, now)).toBe(false);
    expect(
      isFixtureLocked(
        qf,
        all,
        { ...state, settings: { ...state.settings, lockKnockoutOpponents: false } },
        now,
      ),
    ).toBe(false);
    // 次回合只依赖更早阶段，不因首回合没看而锁定（首回合本身也在 r16 之后）
    expect(isFixtureLocked(qf2, all, { ...state, watched: { r16: 1 } }, now)).toBe(false);
    // 联赛不锁
    expect(isFixtureLocked(matches[0]!, matches, state, now)).toBe(false);
  });

  it('节目：相关比赛没看完时锁定', () => {
    const program: Program = {
      id: 'txzq',
      nameZh: '天下足球',
      channel: 'CCTV-5',
      schedule: '每周一',
      description: '',
      platforms: [],
      spoilerRisk: 'high',
      relatedCompetitions: [],
      coverageDays: 7,
      availability: 'available',
    };
    const now = new Date('2026-10-19T12:00:00Z');
    expect(programLockReasons(program, matches, state, now).map((m) => m.id)).toEqual([
      'evt-che',
      'ars-bou',
    ]);
    const all = { ...state, watched: { 'evt-che': 1, 'ars-bou': 1 } };
    expect(programLockReasons(program, matches, all, now)).toEqual([]);
    expect(programLockReasons({ ...program, spoilerRisk: 'low' }, matches, state, now)).toEqual([]);
  });
});

describe('同步码', () => {
  it('导出再导入，内容一致', async () => {
    const state = defaultUserState(123);
    state.teams = ['arsenal', 'nt-brazil'];
    state.competitions = { ucl: 'all' };
    for (let i = 0; i < 300; i++)
      state.watched[`epl-2026-27-team${i}-other${i}`] = 1_790_000_000 + i;
    const code = await encodeSyncCode(state);
    expect(code.startsWith('SFF1.')).toBe(true);
    expect(code.length).toBeLessThan(JSON.stringify(state).length);
    const back = await decodeSyncCode(code);
    expect(back).toEqual(state);
    // 粘贴整条链接也能识别
    expect(await decodeSyncCode(syncLink('https://example.com/app/#/today', code))).toEqual(state);
  });

  it('损坏的同步码报中文错误', async () => {
    await expect(decodeSyncCode('hello')).rejects.toBeInstanceOf(SyncCodeError);
    await expect(decodeSyncCode('SFF1.@@@@')).rejects.toThrow(/损坏|不完整/);
  });

  it('合并：已看记录取并集，订阅以较新的为准', () => {
    const a = { ...defaultUserState(1), watched: { x: 1 }, teams: ['arsenal'] };
    const b = { ...defaultUserState(2), watched: { y: 2 }, teams: ['chelsea'] };
    const merged = mergeUserState(a, b);
    expect(merged.watched).toEqual({ x: 1, y: 2 });
    expect(merged.teams).toEqual(['chelsea']);
  });

  it('清洗外部数据', () => {
    const s = sanitizeUserState({
      v: 1,
      teams: ['a', 3],
      competitions: { epl: 'bad', ucl: 'all' },
      watched: { a: 'x', b: 2 },
    });
    expect(s.teams).toEqual(['a']);
    expect(s.competitions).toEqual({ ucl: 'all' });
    expect(s.watched).toEqual({ b: 2 });
  });
});

describe('两回合总比分只在首回合已看时显示', () => {
  const leg = (id: string, l: 1 | 2, home: string, away: string, kickoff: string) =>
    ({
      id,
      competition: 'ucl',
      season: '2026-27',
      stage: 'quarter-final',
      leg: l,
      kickoff,
      home: { id: home, name: home },
      away: { id: away, name: away },
      status: 'scheduled',
      links: [],
    }) as unknown as PublicMatch;
  const first = leg('ucl-qf-a-b', 1, 'a', 'b', '2027-04-07T19:00:00Z');
  const second = leg('ucl-qf-b-a', 2, 'b', 'a', '2027-04-14T19:00:00Z');
  const other = leg('ucl-qf-c-d', 1, 'c', 'd', '2027-04-07T19:00:00Z');

  it('找首回合：同赛事同赛季同阶段、主客对调', () => {
    expect(firstLegOf(second, [other, first, second])?.id).toBe(first.id);
    expect(firstLegOf(first, [other, first, second])).toBeUndefined();
    expect(firstLegOf(second, [other, second])).toBeUndefined();
  });

  it('首回合没看、或首回合不在数据里：不显示总比分；首回合已看才显示', () => {
    const fresh = defaultUserState(0);
    expect(canShowAggregate(second, [first, second], fresh)).toBe(false);
    expect(canShowAggregate(second, [second], { ...fresh, watched: { [first.id]: 1 } })).toBe(
      false,
    );
    expect(
      canShowAggregate(second, [first, second], { ...fresh, watched: { [first.id]: 1 } }),
    ).toBe(true);
    // 首回合本身、单场淘汰赛：照常
    expect(canShowAggregate(first, [first, second], fresh)).toBe(true);
    expect(canShowAggregate(other, [other], fresh)).toBe(true);
  });
});

describe('只看订阅球队：淘汰赛占位卡不泄露上一轮结果', () => {
  const mk = (id: string, stage: string, home: string, away: string, kickoff: string) =>
    ({
      id,
      competition: 'ucl',
      season: '2026-27',
      stage,
      kickoff,
      home: { id: home, name: home },
      away: { id: away, name: away },
      status: 'scheduled',
      links: [],
    }) as unknown as PublicMatch;
  const now = new Date('2027-03-25T12:00:00Z');
  const r16 = mk('r16-ars', 'round-of-16', 'arsenal', 'inter', '2027-03-10T20:00:00Z');
  const qfA = mk('qf-ars', 'quarter-final', 'arsenal', 'bayern', '2027-04-07T19:00:00Z');
  const qfB = mk('qf-psv', 'quarter-final', 'psv', 'bayern', '2027-04-07T19:00:00Z');
  const base = {
    ...defaultUserState(0),
    teams: ['arsenal'],
    competitions: { ucl: 'teams' as const },
  };

  it('上一轮没看完：不管订阅球队在不在下一轮，列表里都是一张「对阵待揭晓」', () => {
    for (const qf of [qfA, qfB]) {
      const all = [r16, qf];
      expect(isShown(qf, all, base, now)).toBe(true);
      expect(isFixtureLocked(qf, all, base, now)).toBe(true);
      expect(upcomingMatches(all, base, now, 30).map((m) => m.id)).toEqual([qf.id]);
    }
  });

  it('锁定卡能列出是哪场上一轮比赛没看', () => {
    expect(lockBlockers(qfB, [r16, qfB], base, now).map((m) => m.id)).toEqual([r16.id]);
    expect(lockBlockers(qfB, [r16, qfB], { ...base, watched: { [r16.id]: 1 } }, now)).toEqual([]);
  });

  it('看完上一轮后：不是订阅球队的占位卡消失，自己球队的正常显示', () => {
    const watched = { ...base, watched: { [r16.id]: 1 } };
    expect(isShown(qfA, [r16, qfA], watched, now)).toBe(true);
    expect(isFixtureLocked(qfA, [r16, qfA], watched, now)).toBe(false);
    expect(isShown(qfB, [r16, qfB], watched, now)).toBe(false);
    expect(upcomingMatches([r16, qfB], watched, now, 30)).toEqual([]);
  });

  it('「全部比赛」模式、关闭淘汰赛锁定、非淘汰赛：和以前一样', () => {
    expect(isShown(qfB, [r16, qfB], { ...base, competitions: { ucl: 'all' as const } }, now)).toBe(
      true,
    );
    const off = { ...base, settings: { ...base.settings, lockKnockoutOpponents: false } };
    expect(isShown(qfB, [r16, qfB], off, now)).toBe(false);
    const league = mk('md30', 'regular', 'psv', 'bayern', '2027-04-07T19:00:00Z');
    expect(isShown(league, [r16, league], base, now)).toBe(false);
  });
});
