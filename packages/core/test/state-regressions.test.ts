import { describe, expect, it } from 'vitest';
import {
  canShowAggregate,
  decodeSyncCode,
  defaultUserState,
  encodeSyncCode,
  isFixtureLocked,
  isPostponedCleared,
  isWatched,
  mergeUserState,
  postponedClearKey,
  prefsTime,
  programLockReasons,
  sanitizeUserState,
  unwatchedRecent,
  type Program,
  type PublicMatch,
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

const plOfficial: Program = {
  id: 'pl-official',
  nameZh: '英超官方节目',
  channel: '英超',
  schedule: '每周',
  description: '',
  platforms: [],
  spoilerRisk: 'high',
  relatedCompetitions: ['epl'],
  coverageDays: 8,
  availability: 'available',
};

describe('延期/取消的比赛', () => {
  const state = defaultUserState(0);
  const postponed = match({
    id: 'epl-2026-27-arsenal-chelsea',
    kickoff: '2026-10-24T14:00:00Z',
    status: 'postponed',
  });

  it('原定开球之前不锁节目', () => {
    expect(
      programLockReasons(plOfficial, [postponed], state, new Date('2026-10-16T02:00:00Z')),
    ).toEqual([]);
    const cancelled = {
      ...postponed,
      id: 'c',
      status: 'cancelled' as const,
      kickoff: '2026-12-24T15:00:00Z',
    };
    expect(
      programLockReasons(plOfficial, [cancelled], state, new Date('2026-10-16T02:00:00Z')),
    ).toEqual([]);
  });

  it('开球之后中断/取消的比赛仍然锁节目（节目可能会讲到场上发生的事）', () => {
    expect(
      programLockReasons(plOfficial, [postponed], state, new Date('2026-10-25T02:00:00Z')).map(
        (m) => m.id,
      ),
    ).toEqual(['epl-2026-27-arsenal-chelsea']);
    // 标记为已看后解除
    expect(
      programLockReasons(
        plOfficial,
        [postponed],
        { ...state, watched: { [postponed.id]: 4_000_000_000 } },
        new Date('2026-10-25T02:00:00Z'),
      ),
    ).toEqual([]);
  });

  it('手动标记按原定开球时间记：改期重赛的那场照常锁节目', () => {
    const cleared = {
      ...state,
      unlocked: { [postponedClearKey(postponed)]: 1 },
    };
    expect(isPostponedCleared(cleared, postponed)).toBe(true);
    expect(
      programLockReasons(plOfficial, [postponed], cleared, new Date('2026-10-25T02:00:00Z')),
    ).toEqual([]);
    // 同一个 id 改到 11/04 重赛
    const replayed = {
      ...postponed,
      status: 'scheduled' as const,
      kickoff: '2026-11-04T20:00:00Z',
    };
    expect(isPostponedCleared(cleared, replayed)).toBe(false);
    expect(
      programLockReasons(plOfficial, [replayed], cleared, new Date('2026-11-05T02:00:00Z')).map(
        (m) => m.id,
      ),
    ).toEqual([postponed.id]);
    // 改了时间但仍是延期状态：也不再算标记过
    expect(isPostponedCleared(cleared, { ...postponed, kickoff: '2026-11-04T20:00:00Z' })).toBe(
      false,
    );
    // 原定时间不变、状态改回正常（当时其实照常开赛）：照常算没看
    expect(isPostponedCleared(cleared, { ...postponed, status: 'scheduled' })).toBe(false);
    // 同一时刻的不同写法算同一场
    expect(isPostponedCleared(cleared, { ...postponed, kickoff: '2026-10-24T14:00:00.000Z' })).toBe(
      true,
    );
  });

  it('上一轮延期时手动标记过，改期重赛后下一轮对阵照常藏起来', () => {
    const r16 = match({
      id: 'r16',
      competition: 'ucl',
      stage: 'round-of-16',
      kickoff: '2027-03-10T20:00:00Z',
      status: 'postponed',
      away: { id: 'psv', name: '' },
    });
    const qf = match({
      id: 'qf',
      competition: 'ucl',
      stage: 'quarter-final',
      kickoff: '2027-04-07T19:00:00Z',
      away: { id: 'bayern', name: '' },
    });
    const cleared = { ...state, unlocked: { [postponedClearKey(r16)]: 1 } };
    expect(isFixtureLocked(qf, [r16, qf], cleared, new Date('2027-03-11T00:00:00Z'))).toBe(false);
    const played = { ...r16, status: 'scheduled' as const, kickoff: '2027-03-17T20:00:00Z' };
    expect(isFixtureLocked(qf, [played, qf], cleared, new Date('2027-03-18T00:00:00Z'))).toBe(true);
  });

  it('上一轮提前延期的比赛在开球前不锁下一轮对阵', () => {
    const r16 = match({
      id: 'r16',
      competition: 'ucl',
      stage: 'round-of-16',
      kickoff: '2027-03-10T20:00:00Z',
      status: 'postponed',
      away: { id: 'psv', name: '' },
    });
    const qf = match({
      id: 'qf',
      competition: 'ucl',
      stage: 'quarter-final',
      kickoff: '2027-04-07T19:00:00Z',
      away: { id: 'bayern', name: '' },
    });
    expect(isFixtureLocked(qf, [r16, qf], state, new Date('2027-03-01T00:00:00Z'))).toBe(false);
    // 开球后中断的比赛仍按没看完处理
    expect(isFixtureLocked(qf, [r16, qf], state, new Date('2027-03-11T00:00:00Z'))).toBe(true);
  });
});

describe('欧冠淘汰附加赛', () => {
  const state = defaultUserState(0);
  const league = match({
    id: 'ucl-md8',
    competition: 'ucl',
    stage: 'league-phase',
    matchday: 8,
    kickoff: '2027-01-27T20:00:00Z',
    away: { id: 'x-celtic', name: 'Celtic' },
  });
  const playoff1 = match({
    id: 'ucl-po-1',
    competition: 'ucl',
    stage: 'playoff',
    leg: 1,
    matchday: undefined,
    kickoff: '2027-02-16T20:00:00Z',
    away: { id: 'x-celtic', name: 'Celtic' },
  });
  const playoff2 = {
    ...playoff1,
    id: 'ucl-po-2',
    leg: 2 as const,
    kickoff: '2027-02-24T20:00:00Z',
  };
  const r16 = {
    ...playoff1,
    id: 'ucl-r16',
    stage: 'round-of-16' as const,
    kickoff: '2027-03-09T20:00:00Z',
  };
  const all = [league, playoff1, playoff2, r16];
  const now = new Date('2027-02-01T00:00:00Z');

  it('联赛阶段没看完时，附加赛对阵也藏起来', () => {
    expect(isFixtureLocked(playoff1, all, state, now)).toBe(true);
    expect(isFixtureLocked(r16, all, state, now)).toBe(true);
    expect(
      isFixtureLocked(playoff1, all, { ...state, watched: { 'ucl-md8': 4_000_000_000 } }, now),
    ).toBe(false);
  });

  it('附加赛次回合不因首回合没看而锁定', () => {
    const later = new Date('2027-02-20T00:00:00Z');
    expect(
      isFixtureLocked(playoff2, all, { ...state, watched: { 'ucl-md8': 4_000_000_000 } }, later),
    ).toBe(false);
  });

  it('资格赛仍然锁附加赛', () => {
    const q = { ...league, id: 'q', stage: 'qualifying' as const, kickoff: '2027-02-05T20:00:00Z' };
    expect(
      isFixtureLocked(
        playoff1,
        [q, playoff1],
        { ...state, watched: { 'ucl-md8': 4_000_000_000 } },
        new Date('2027-02-10T00:00:00Z'),
      ),
    ).toBe(true);
  });
});

describe('合并：订阅和设置按自己的修改时间', () => {
  it('只是标记了已看的设备，不会盖掉另一台设备更新过的订阅', () => {
    // 设备 A：10/15 改了订阅
    const a = {
      ...defaultUserState(Date.parse('2026-10-15T12:00:00Z')),
      teams: ['leeds'],
      competitions: { epl: 'all' as const },
      prefsUpdatedAt: Date.parse('2026-10-15T12:00:00Z'),
    };
    // 设备 B：订阅是 10/01 的，10/16 只点了"显示比分"
    const b = {
      ...defaultUserState(Date.parse('2026-10-16T01:00:00Z')),
      teams: ['arsenal'],
      watched: { m1: 1 },
      prefsUpdatedAt: Date.parse('2026-10-01T00:00:00Z'),
    };
    const merged = mergeUserState(b, a);
    expect(merged.teams).toEqual(['leeds']);
    expect(merged.competitions).toEqual({ epl: 'all' });
    expect(merged.watched).toEqual({ m1: 1 });
    expect(merged.updatedAt).toBe(b.updatedAt);
    expect(prefsTime(merged)).toBe(a.prefsUpdatedAt);
  });

  it('没保存过的默认状态（时间 0）不会盖掉导入的订阅、设置和同步服务器', async () => {
    const a = {
      ...defaultUserState(Date.parse('2026-10-15T12:00:00Z')),
      teams: ['leeds'],
      competitions: { epl: 'all' as const },
      settings: {
        lockKnockoutOpponents: false,
        embedMask: true,
        upcomingDays: 14,
        syncEndpoint: 'https://sync.example.workers.dev',
        syncKey: 'abcdefghijklmnopqrstuv',
      },
      watched: { m1: 1 },
    };
    const incoming = await decodeSyncCode(await encodeSyncCode(a));
    const merged = mergeUserState(defaultUserState(0), incoming);
    expect(merged.teams).toEqual(['leeds']);
    expect(merged.competitions).toEqual({ epl: 'all' });
    expect(merged.settings).toEqual(a.settings);
    expect(merged.watched).toEqual({ m1: 1 });
  });

  it('旧数据没有 prefsUpdatedAt 时退回 updatedAt；清洗时保留合法值', () => {
    expect(prefsTime(defaultUserState(5))).toBe(5);
    expect(sanitizeUserState({ v: 1, updatedAt: 9, prefsUpdatedAt: 7 }).prefsUpdatedAt).toBe(7);
    expect(sanitizeUserState({ v: 1, updatedAt: 9, prefsUpdatedAt: 'x' }).prefsUpdatedAt).toBe(
      undefined,
    );
  });
});

describe('已看记录只对这一次安排的比赛有效（比赛 id 不含日期）', () => {
  const faCupShow: Program = { ...plOfficial, id: 'fa-cup-show', relatedCompetitions: ['fa-cup'] };
  const r3 = match({
    id: 'fa-cup-2026-27-round-3-arsenal-chelsea',
    competition: 'fa-cup',
    stage: 'round-3',
    matchday: undefined,
    kickoff: '2027-01-09T15:00:00Z',
  });
  const r4 = match({
    id: 'fa-cup-2026-27-round-4-arsenal-everton',
    competition: 'fa-cup',
    stage: 'round-4',
    matchday: undefined,
    kickoff: '2027-01-30T15:00:00Z',
    away: { id: 'everton', name: 'Everton' },
  });
  // 开球 4 小时后点了「显示比分」但比分缺失（当天其实延期了，数据还没更新），记录照样写进 watched
  const state = {
    ...defaultUserState(0),
    teams: ['arsenal'],
    watched: { [r3.id]: Math.floor(Date.parse('2027-01-09T19:00:00Z') / 1000) },
  };

  it('按原定时间踢的那场算已看', () => {
    expect(isWatched(state, r3)).toBe(true);
    expect(unwatchedRecent([r3, r4], state, new Date('2027-01-10T02:00:00Z'))).toEqual([]);
    expect(isFixtureLocked(r4, [r3, r4], state, new Date('2027-01-25T02:00:00Z'))).toBe(false);
  });

  it('改期重赛（同一 id、开球变晚）的那场照常算没看：下一轮对阵和节目都照常锁', () => {
    const replayed = { ...r3, kickoff: '2027-01-23T19:45:00Z' };
    const after = new Date('2027-01-24T02:00:00Z');
    expect(isWatched(state, replayed)).toBe(false);
    expect(unwatchedRecent([replayed, r4], state, after).map((m) => m.id)).toEqual([replayed.id]);
    expect(isFixtureLocked(r4, [replayed, r4], state, after)).toBe(true);
    expect(programLockReasons(faCupShow, [replayed, r4], state, after).map((m) => m.id)).toEqual([
      replayed.id,
    ]);
  });

  it('两回合：首回合改期后旧记录失效，次回合不再显示总比分', () => {
    const first = match({
      id: 'ucl-2026-27-semi-final-chelsea-arsenal',
      competition: 'ucl',
      stage: 'semi-final',
      matchday: undefined,
      leg: 1,
      kickoff: '2027-04-28T19:00:00Z',
      home: { id: 'chelsea', name: 'Chelsea' },
      away: { id: 'arsenal', name: 'Arsenal' },
    });
    const second = match({
      id: 'ucl-2026-27-semi-final-arsenal-chelsea',
      competition: 'ucl',
      stage: 'semi-final',
      matchday: undefined,
      leg: 2,
      kickoff: '2027-05-05T19:00:00Z',
    });
    const s = {
      ...state,
      watched: { [first.id]: Math.floor(Date.parse('2027-04-28T23:00:00Z') / 1000) },
    };
    expect(canShowAggregate(second, [first, second], s)).toBe(true);
    const firstMoved = { ...first, kickoff: '2027-05-01T19:00:00Z' };
    expect(canShowAggregate(second, [firstMoved, second], s)).toBe(false);
  });
});
