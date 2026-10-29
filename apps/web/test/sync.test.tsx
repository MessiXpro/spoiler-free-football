import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { defaultUserState, sanitizeUserState, type UserState } from '@sff/core';
import { buttonByText, cleanup, click, q, render, settle } from './render.tsx';

/** 每个用例都像新打开页面一样重新加载 store（模块级单例） */
async function freshApp() {
  vi.resetModules();
  const store = await import('../src/lib/store.ts');
  const bridge = await import('../src/lib/bridge.ts');
  const settings = await import('../src/views/SettingsView.tsx');
  const sync = await import('../src/lib/sync-server.ts');
  return { store, bridge, settings, sync };
}

const T0 = Date.parse('2026-10-16T01:00:00Z');

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await cleanup();
});

describe('在新设备上导入同步码', () => {
  const deviceA: UserState = {
    ...defaultUserState(Date.parse('2026-10-15T12:00:00Z')),
    teams: ['leeds'],
    competitions: { epl: 'all' },
    settings: {
      lockKnockoutOpponents: false,
      embedMask: true,
      upcomingDays: 14,
      syncEndpoint: 'https://sync.example.workers.dev',
      syncKey: 'abcdefghijklmnopqrstuv',
    },
    watched: { m1: 1_790_000_000 },
  };

  it('订阅、赛事、设置和同步服务器都带过来（插件先同步过已看记录也一样）', async () => {
    const { store, settings } = await freshApp();
    // 和 decodeSyncCode 的结果一样（jsdom 的 Blob 不支持 stream，这里直接清洗）
    const incoming = sanitizeUserState(JSON.parse(JSON.stringify(deviceA)));
    // 页面加载时插件发来已看记录（会写入一次状态）
    store.mergeWatched({ m2: 1_790_000_100 });
    const done = vi.fn();
    await render(
      <settings.ImportConfirm incoming={incoming} current={store.getState()} onDone={done} />,
    );
    await click(q(document.body, 'confirm-ok'));
    const s = store.getState();
    expect(done).toHaveBeenCalledWith(true);
    expect(s.teams).toEqual(['leeds']);
    expect(s.competitions).toEqual({ epl: 'all' });
    expect(s.settings).toEqual(deviceA.settings);
    expect(s.watched).toEqual({ m1: 1_790_000_000, m2: 1_790_000_100 });
  });

  it('没保存过的本机状态不会盖掉服务器上的订阅', async () => {
    const { store } = await freshApp();
    store.mergeState(deviceA);
    expect(store.getState().teams).toEqual(['leeds']);
  });

  it('只是标记了已看，不会让本机旧的订阅盖掉另一台设备更新过的订阅', async () => {
    const { store } = await freshApp();
    store.actions.toggleTeam('leeds'); // 10/16 01:00 改订阅
    vi.setSystemTime(T0 + 86_400_000);
    store.actions.markWatched('m3'); // 10/17 只点了"显示比分"
    const remote: UserState = {
      ...defaultUserState(T0 + 3_600_000),
      teams: ['brighton'],
      prefsUpdatedAt: T0 + 3_600_000, // 另一台设备 10/16 02:00 改了订阅
    };
    store.mergeState(remote);
    expect(store.getState().teams).toEqual(['brighton']);
    expect(store.getState().watched.m3).toBeTruthy();
  });
});

describe('「藏起比分并标记为没看」和清空本机数据不会被插件/脚本恢复', () => {
  it('插件发回旧的已看记录时不再加回来；之后在插件里重新看过的照常同步', async () => {
    const { store } = await freshApp();
    store.actions.markWatched('X');
    const markedAt = store.getState().watched.X!;
    vi.setSystemTime(T0 + 60_000);
    store.actions.unmarkWatched('X');
    store.mergeWatched({ X: markedAt });
    expect(store.getState().watched.X).toBeUndefined();
    // 同步服务器/同步码带回来的旧记录也一样
    store.mergeState({ ...defaultUserState(0), watched: { X: markedAt } });
    expect(store.getState().watched.X).toBeUndefined();
    // 删除之后才在插件里看的
    store.mergeWatched({ X: markedAt + 3600 });
    expect(store.getState().watched.X).toBe(markedAt + 3600);
  });

  it('同一场以较晚的时间为准：比分缺失时记下的旧记录，被改期重赛后在插件里看完的新记录盖掉', async () => {
    const { store } = await freshApp();
    store.actions.markWatched('X');
    const markedAt = store.getState().watched.X!;
    // 插件发回更早的记录：不动
    store.mergeWatched({ X: markedAt - 3600 });
    expect(store.getState().watched.X).toBe(markedAt);
    // 两周后在插件里看完重赛：取新时间（否则 isWatched 对重赛的那场永远是 false）
    store.mergeWatched({ X: markedAt + 14 * 86_400 });
    expect(store.getState().watched.X).toBe(markedAt + 14 * 86_400);
  });

  it('清空本机数据后，插件发回的整份已看记录不会恢复', async () => {
    const { store } = await freshApp();
    store.actions.markWatched('X');
    store.actions.markWatched('Y');
    const old = { ...store.getState().watched };
    vi.setSystemTime(T0 + 60_000);
    store.actions.reset();
    store.mergeWatched(old);
    expect(store.getState().watched).toEqual({});
  });

  it('联动：网页告诉插件删掉了哪些；插件发回的旧记录不会把它加回来', async () => {
    const { store, bridge } = await freshApp();
    // 模拟只会追加的插件：收到 state 就合并，并把自己的整份记录发回来
    const shield: Record<string, number> = {};
    const posted: Array<Record<string, unknown>> = [];
    const realPost = window.postMessage.bind(window);
    vi.spyOn(window, 'postMessage').mockImplementation((msg: unknown) => {
      const m = msg as Record<string, unknown> & { watched?: Record<string, number> };
      if (m.source !== 'sff-web') return realPost(msg, '*');
      posted.push(m);
      if (m.type === 'state' || m.type === 'hello') {
        for (const [id, t] of Object.entries(m.watched ?? {})) shield[id] ??= t;
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { source: 'sff-shield', type: 'watched', watched: { ...shield } },
            source: window,
            origin: window.location.origin,
          }),
        );
      }
    });
    const stop = bridge.initBridge();
    store.actions.markWatched('X');
    expect(shield.X).toBeTruthy();
    vi.setSystemTime(T0 + 60_000);
    store.actions.unmarkWatched('X');
    expect(posted.some((m) => m.type === 'unwatch' && (m.ids as string[]).includes('X'))).toBe(
      true,
    );
    expect(store.getState().watched.X).toBeUndefined();
    stop();
    // 重新打开页面：hello 带上删除记录，插件发回的旧记录仍然不会恢复
    const again = await freshApp();
    again.bridge.initBridge()();
    const hello = posted.filter((m) => m.type === 'hello').at(-1)!;
    expect((hello.unwatched as Record<string, number>).X).toBeTruthy();
    expect(again.store.getState().watched.X).toBeUndefined();
  });
});

describe('同步服务器', () => {
  const endpoint = 'https://sync.example.workers.dev';
  const key = 'abcdefghijklmnopqrstuv';

  it('上传前先合并服务器上的记录，不会冲掉其他设备上传的已看记录', async () => {
    const { store, settings } = await freshApp();
    store.actions.updateSettings({ syncEndpoint: endpoint, syncKey: key });
    store.actions.markWatched('m-B');
    let server = JSON.stringify({
      ...defaultUserState(T0 - 3_600_000),
      watched: { 'm-A': 1_790_000_000 },
      settings: { ...defaultUserState().settings, syncEndpoint: endpoint, syncKey: key },
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        server = String(init.body);
        return new Response('{"ok":true}', { status: 200 });
      }
      return new Response(server, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    function Live({ children }: { children: (s: UserState) => ReactNode }) {
      return <>{children(store.useUserState())}</>;
    }
    const { el } = await render(<Live>{(s) => <settings.SettingsView state={s} />}</Live>);
    expect(el.textContent).not.toContain('自动同步');
    await click(buttonByText(el, '上传到服务器'));
    await settle();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true);
    expect(Object.keys((JSON.parse(server) as UserState).watched).sort()).toEqual(['m-A', 'm-B']);
  });
});

describe('「清空本机数据」后仍能从备份恢复已看记录', () => {
  it('导入同步码备份：已看记录和订阅一起回来；插件发回的旧记录仍然不恢复', async () => {
    const { store } = await freshApp();
    store.actions.toggleTeam('leeds');
    store.actions.markWatched('X');
    store.actions.markWatched('Y');
    const backup = sanitizeUserState(JSON.parse(JSON.stringify(store.getState())));
    vi.setSystemTime(T0 + 60_000);
    store.actions.reset();
    // 插件/脚本发回清空前的整份记录：照旧不恢复
    store.mergeWatched(backup.watched);
    expect(store.getState().watched).toEqual({});
    // 用户明确导入备份：已看记录回来，之后 hello 里也不再把它们当成删掉的
    store.importState(backup);
    expect(store.getState().watched).toEqual(backup.watched);
    expect(store.getState().teams).toContain('leeds');
    expect(store.shieldRemoved()).toEqual({});
  });

  it('清空后上传到服务器：服务器上的记录保留，自己「藏起比分并标记为没看」的仍然不回来', async () => {
    const { store, sync } = await freshApp();
    store.actions.markWatched('A');
    store.actions.markWatched('B');
    const backup = sanitizeUserState(JSON.parse(JSON.stringify(store.getState())));
    vi.setSystemTime(T0 + 60_000);
    store.actions.unmarkWatched('B');
    vi.setSystemTime(T0 + 120_000);
    store.actions.reset();
    let server = JSON.stringify({
      ...backup,
      watched: { ...backup.watched, C: Math.floor(T0 / 1000) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          server = String(init.body);
          return new Response('{"ok":true}', { status: 200 });
        }
        return new Response(server, { status: 200 });
      }),
    );
    await sync.uploadToServer('https://sync.example.workers.dev', 'abcdefghijklmnopqrstuv');
    expect(Object.keys((JSON.parse(server) as UserState).watched).sort()).toEqual(['A', 'C']);
    expect(Object.keys(store.getState().watched).sort()).toEqual(['A', 'C']);
  });
});
