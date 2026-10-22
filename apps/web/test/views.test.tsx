import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  defaultUserState,
  findSpoilers,
  isFixtureLocked,
  postponedClearKey,
  programLockReasons,
  scorePath,
  unwatchedRecent,
  type MatchLink,
  type Program,
  type UserState,
} from '@sff/core';
import { Embed } from '../src/components/Embed.tsx';
import { MatchCard } from '../src/components/MatchCard.tsx';
import { getState, setState, useUserState } from '../src/lib/store.ts';
import { MatchDetailView, TonightView, UnwatchedView } from '../src/views/MatchViews.tsx';
import { ProgramsView } from '../src/views/ProgramsView.tsx';
import {
  appData,
  cleanup,
  buttonByText,
  cardOf,
  click,
  match,
  q,
  render,
  settle,
  textNodes,
} from './render.tsx';

function WithStore({ children }: { children: (state: UserState) => ReactNode }) {
  return <>{children(useUserState())}</>;
}

function noSpoilers(el: Element) {
  const hits = textNodes(el).filter((t) => findSpoilers(t, { football: true }).length > 0);
  expect(hits).toEqual([]);
}

const txzq: Program = {
  id: 'txzq',
  nameZh: '天下足球',
  channel: 'CCTV-5',
  schedule: '每周一',
  description: '',
  platforms: [],
  spoilerRisk: 'high',
  relatedCompetitions: [],
  coverageDays: 8,
  availability: 'available',
};

beforeEach(() => {
  localStorage.clear();
  setState(defaultUserState(0));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup();
});

describe('节目折叠原因不暴露锁定的对阵', () => {
  const r16 = match({
    id: 'world-cup-2026-round-of-16-nt-france-nt-germany',
    competition: 'world-cup',
    season: '2026',
    stage: 'round-of-16',
    matchday: undefined,
    kickoff: '2026-07-04T20:00:00Z',
    home: { id: 'nt-france', name: 'France' },
    away: { id: 'nt-germany', name: 'Germany' },
  });
  const qf = match({
    ...r16,
    id: 'world-cup-2026-quarter-final-nt-france-nt-brazil',
    stage: 'quarter-final',
    kickoff: '2026-07-09T20:00:00Z',
    away: { id: 'nt-brazil', name: 'Brazil' },
  });
  const now = new Date('2026-07-10T02:00:00Z');
  const data = appData([r16, qf], [txzq]);

  it('节目页：锁定的淘汰赛只写「对阵待揭晓」，也不给带队名的链接', async () => {
    const { el } = await render(<ProgramsView data={data} state={getState()} now={now} />);
    const locked = q(el, 'program-locked')!;
    expect(locked).not.toBeNull();
    expect(locked.textContent).toContain('法国 vs 德国');
    expect(locked.textContent).toContain('对阵待揭晓');
    expect(locked.textContent).not.toContain('巴西');
    const hrefs = [...locked.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('nt-brazil'))).toBe(false);
    expect(hrefs.some((h) => h.includes('round-of-16'))).toBe(true);
    noSpoilers(el);
  });

  it('详情页：对阵锁定时不显示由队名拼成的比赛编号', async () => {
    const { el } = await render(
      <MatchDetailView data={data} state={getState()} now={now} id={qf.id} />,
    );
    expect(q(el, 'locked-teams')).not.toBeNull();
    expect(q(el, 'match-id')).toBeNull();
    expect(el.textContent).not.toContain('nt-brazil');
    expect(el.textContent).not.toContain('巴西');

    const other = await render(
      <MatchDetailView data={data} state={getState()} now={now} id={r16.id} />,
    );
    expect(q(other.el, 'match-id')?.textContent).toContain(r16.id);
  });
});

describe('在「没看完」列表里显示比分', () => {
  const recent = match({ id: 'epl-2026-27-arsenal-chelsea', kickoff: '2026-10-15T11:30:00Z' });
  const older = match({
    id: 'epl-2026-27-everton-arsenal',
    kickoff: '2026-10-12T11:30:00Z',
    home: { id: 'everton', name: 'Everton' },
    away: { id: 'arsenal', name: 'Arsenal' },
  });
  const now = new Date('2026-10-16T01:00:00Z');
  const data = appData([recent, older]);

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        // 比分文件名是比赛 id 的哈希，按文件名找回是哪一场
        const id = [recent, older].map((m) => m.id).find((x) => String(url).endsWith(scorePath(x)));
        if (!id) return new Response('', { status: 404 });
        return new Response(
          JSON.stringify({ id, home: 2, away: 1, source: 'test', updatedAt: '' }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );
  });

  it('没看完：确认后卡片留在列表里并显示比分；下次打开页面才移出', async () => {
    const view = <WithStore>{(s) => <UnwatchedView data={data} state={s} now={now} />}</WithStore>;
    const { el, unmount } = await render(view);
    const card = cardOf(el, recent.id)!;
    expect(card).not.toBeNull();
    await click(q(card, 'reveal-button'));
    await click(q(document.body, 'confirm-ok'));
    await settle();
    expect(getState().watched[recent.id]).toBeTruthy();
    expect(q(cardOf(el, recent.id)!, 'score-display')).not.toBeNull();
    await unmount();

    const again = await render(view);
    expect(cardOf(again.el, recent.id)).toBeNull();
    expect(cardOf(again.el, older.id)).not.toBeNull();
  });

  it('昨夜今晨的「更早还没看完的」：同样能看到比分', async () => {
    const { el } = await render(
      <WithStore>{(s) => <TonightView data={data} state={s} now={now} offset={0} />}</WithStore>,
    );
    const card = cardOf(el, older.id)!;
    expect(card).not.toBeNull();
    await click(q(card, 'reveal-button'));
    await click(q(document.body, 'confirm-ok'));
    await settle();
    expect(q(cardOf(el, older.id)!, 'score-display')).not.toBeNull();
  });
});

describe('北京时间中午到午夜开球的比赛', () => {
  const evening = match({ id: 'epl-2026-27-arsenal-chelsea', kickoff: '2026-10-17T14:00:00Z' });
  const data = appData([evening]);

  it('进行中时出现在昨夜今晨的「进行中」', async () => {
    const now = new Date('2026-10-17T15:00:00Z');
    const { el } = await render(
      <TonightView data={data} state={getState()} now={now} offset={0} />,
    );
    const live = q(el, 'live-now');
    expect(live).not.toBeNull();
    expect(cardOf(live!, evening.id)).not.toBeNull();
    expect(q(cardOf(live!, evening.id)!, 'match-status')?.textContent).toBe('进行中');
    noSpoilers(el);
  });

  it('开球前和往前翻页时不出现', async () => {
    const before = await render(
      <TonightView
        data={data}
        state={getState()}
        now={new Date('2026-10-17T13:00:00Z')}
        offset={0}
      />,
    );
    expect(q(before.el, 'live-now')).toBeNull();
    const prev = await render(
      <TonightView
        data={data}
        state={getState()}
        now={new Date('2026-10-17T15:00:00Z')}
        offset={-1}
      />,
    );
    expect(q(prev.el, 'live-now')).toBeNull();
  });
});

describe('延期/取消的比赛', () => {
  const postponed = match({
    id: 'epl-2026-27-arsenal-chelsea',
    kickoff: '2026-10-10T14:00:00Z',
    status: 'postponed',
  });

  it('开球时间过后可以手动标记为已看，解除节目折叠', async () => {
    const now = new Date('2026-10-12T02:00:00Z');
    const { el } = await render(
      <WithStore>
        {(s) => <MatchCard match={postponed} all={[postponed]} state={s} now={now} />}
      </WithStore>,
    );
    expect(
      programLockReasons({ ...txzq, coverageDays: 7 }, [postponed], getState(), now),
    ).toHaveLength(1);
    await click(q(el, 'mark-watched'));
    noSpoilers(document.body);
    await click(q(document.body, 'confirm-ok'));
    // 不记进 watched（id 不含日期，改期后的那场会被当成已看），按原定开球时间记一条解锁
    expect(getState().watched[postponed.id]).toBeUndefined();
    expect(getState().unlocked[postponedClearKey(postponed)]).toBeTruthy();
    expect(programLockReasons({ ...txzq, coverageDays: 7 }, [postponed], getState(), now)).toEqual(
      [],
    );
    expect(q(el, 'watched-badge')).not.toBeNull();
    await click(q(el, 'unmark-watched'));
    expect(getState().unlocked[postponedClearKey(postponed)]).toBeUndefined();
    expect(
      programLockReasons({ ...txzq, coverageDays: 7 }, [postponed], getState(), now),
    ).toHaveLength(1);
  });

  it('标记过的延期比赛改期重赛后，重新安排的那场照常算没看', async () => {
    const now = new Date('2026-10-12T02:00:00Z');
    const { el, unmount } = await render(
      <WithStore>
        {(s) => <MatchCard match={postponed} all={[postponed]} state={s} now={now} />}
      </WithStore>,
    );
    await click(q(el, 'mark-watched'));
    await click(q(document.body, 'confirm-ok'));
    await unmount();

    // 同一个 id 改到 11/04 重赛，并且已经踢完
    const replayed = match({ id: postponed.id, kickoff: '2026-11-04T20:00:00Z' });
    const later = new Date('2026-11-05T02:00:00Z');
    expect(
      programLockReasons(
        { ...txzq, relatedCompetitions: ['epl'] },
        [replayed],
        getState(),
        later,
      ).map((m) => m.id),
    ).toEqual([replayed.id]);
    expect(unwatchedRecent([replayed], getState(), later).map((m) => m.id)).toEqual([replayed.id]);
    const card = await render(
      <MatchCard match={replayed} all={[replayed]} state={getState()} now={later} />,
    );
    expect(q(card.el, 'watched-badge')).toBeNull();
    // 显示比分仍然要先确认
    expect(q(card.el, 'reveal-button')?.textContent).toBe('看完了，显示比分');
    await click(q(card.el, 'reveal-button'));
    expect(q(document.body, 'confirm-ok')).not.toBeNull();
    await card.unmount();

    // 淘汰赛：上一轮延期时标记过，改期重赛后下一轮对阵照常藏起来
    const r16 = match({
      id: 'ucl-2026-27-round-of-16-arsenal-psv',
      competition: 'ucl',
      stage: 'round-of-16',
      kickoff: '2027-03-10T20:00:00Z',
      status: 'postponed',
      away: { id: 'psv', name: 'PSV' },
    });
    const r16card = await render(
      <WithStore>
        {(s) => (
          <MatchCard match={r16} all={[r16]} state={s} now={new Date('2027-03-11T00:00:00Z')} />
        )}
      </WithStore>,
    );
    await click(q(r16card.el, 'mark-watched'));
    await click(q(document.body, 'confirm-ok'));
    const qf = match({
      id: 'qf',
      competition: 'ucl',
      stage: 'quarter-final',
      kickoff: '2027-04-07T19:00:00Z',
      away: { id: 'bayern', name: 'Bayern' },
    });
    expect(isFixtureLocked(qf, [r16, qf], getState(), new Date('2027-03-12T00:00:00Z'))).toBe(
      false,
    );
    const r16played = { ...r16, status: 'scheduled' as const, kickoff: '2027-03-17T20:00:00Z' };
    expect(isFixtureLocked(qf, [r16played, qf], getState(), new Date('2027-03-18T00:00:00Z'))).toBe(
      true,
    );
  });

  it('原定开球之前没有这个按钮', async () => {
    const { el } = await render(
      <MatchCard
        match={postponed}
        all={[postponed]}
        state={getState()}
        now={new Date('2026-10-09T00:00:00Z')}
      />,
    );
    expect(q(el, 'mark-watched')).toBeNull();
  });
});

describe('内嵌播放器全屏', () => {
  const link: MatchLink = {
    kind: 'replay',
    platform: 'bilibili',
    url: 'https://www.bilibili.com/video/BV1sffSample',
    label: 'B 站 · 全场回放',
    embed: { provider: 'bilibili', bvid: 'BV1sffSample' },
  };
  const m = match({ id: 'epl-2026-27-arsenal-chelsea', kickoff: '2026-10-10T14:00:00Z' });

  it('不允许播放器自己全屏（那样遮挡条盖不住时长和进度条）', async () => {
    const { el } = await render(<Embed match={m} link={link} mask liveMode />);
    await click(q(el, 'embed-play'));
    const iframe = q(el, 'embed-iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.hasAttribute('allowfullscreen')).toBe(false);
    expect(iframe.getAttribute('allow') ?? '').not.toMatch(/fullscreen/);
    expect(q(el, 'embed-mask')).not.toBeNull();
  });

  it('「全屏」按钮全屏的是外层容器；浏览器不支持时不显示按钮', async () => {
    const first = await render(<Embed match={m} link={link} mask liveMode />);
    await click(q(first.el, 'embed-play'));
    expect(q(first.el, 'embed-fullscreen')).toBeNull();
    await first.unmount();

    const request = vi.fn(async () => {});
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    const proto = HTMLElement.prototype as { requestFullscreen?: unknown };
    const original = proto.requestFullscreen;
    proto.requestFullscreen = request;
    try {
      const { el } = await render(<Embed match={m} link={link} mask liveMode />);
      await click(q(el, 'embed-play'));
      await click(buttonByText(el, '全屏'));
      expect(request).toHaveBeenCalledTimes(1);
      expect((request.mock.contexts as unknown[])[0]).toBe(q(el, 'embed'));
    } finally {
      proto.requestFullscreen = original;
      Reflect.deleteProperty(document, 'fullscreenEnabled');
    }
  });
});

describe('次回合的两回合总比分', () => {
  const first = match({
    id: 'ucl-2026-27-quarter-final-arsenal-real-madrid',
    kickoff: '2026-10-08T19:00:00Z',
    competition: 'ucl',
    stage: 'quarter-final',
    leg: 1,
    home: { id: 'arsenal', name: 'Arsenal' },
    away: { id: 'real-madrid', name: 'Real Madrid' },
  } as Parameters<typeof match>[0]);
  const second = match({
    id: 'ucl-2026-27-quarter-final-real-madrid-arsenal',
    kickoff: '2026-10-15T19:00:00Z',
    competition: 'ucl',
    stage: 'quarter-final',
    leg: 2,
    home: { id: 'real-madrid', name: 'Real Madrid' },
    away: { id: 'arsenal', name: 'Arsenal' },
  } as Parameters<typeof match>[0]);
  const now = new Date('2026-10-16T01:00:00Z');
  const data = appData([second, first]);

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const id = [first, second].map((m) => m.id).find((x) => String(url).endsWith(scorePath(x)));
        if (!id) return new Response('', { status: 404 });
        return new Response(
          JSON.stringify({
            id,
            home: 2,
            away: 1,
            aggregate: [3, 3],
            source: 'test',
            updatedAt: '',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );
  });

  it('首回合没看时显示次回合比分但不显示总比分；首回合看过后才显示', async () => {
    // 次回合直接显示：对阵不锁（测试里关掉淘汰赛锁定，只看总比分的逻辑）
    setState({ ...getState(), settings: { ...getState().settings, lockKnockoutOpponents: false } });
    const view = <WithStore>{(s) => <UnwatchedView data={data} state={s} now={now} />}</WithStore>;
    const { el, unmount } = await render(view);
    const card = cardOf(el, second.id)!;
    await click(q(card, 'reveal-button'));
    await click(q(document.body, 'confirm-ok'));
    await settle();
    const shown = cardOf(el, second.id)!;
    expect(q(shown, 'score-display')).not.toBeNull();
    expect(q(shown, 'score-aggregate')).toBeNull();
    expect(q(shown, 'score-aggregate-hidden')).not.toBeNull();
    expect(shown.textContent).not.toContain('3 - 3');
    await unmount();

    // 首回合看过之后（次回合已记为已看，「没看完」里不再有它，去详情页看）
    setState({ ...getState(), watched: { ...getState().watched, [first.id]: 1 } });
    const again = await render(
      <WithStore>
        {(s) => <MatchDetailView data={data} state={s} now={now} id={second.id} />}
      </WithStore>,
    );
    const c2 = cardOf(again.el, second.id)!;
    await click(q(c2, 'reveal-button'));
    await settle();
    expect(q(cardOf(again.el, second.id)!, 'score-aggregate')?.textContent).toContain('3 - 3');
  });
});
