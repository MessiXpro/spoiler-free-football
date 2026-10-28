import { DEFAULT_SITE_RULES_JSON, scorePath, validateSiteRules } from '@sff/core';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTimeWindow } from '../src/schedule.ts';

/**
 * 在 jsdom 里加载整个用户脚本（main.ts 导入时就会运行），模拟脚本管理器的 GM 存储和菜单。
 * jsdom 的地址是 http://localhost:3000/：没有站点规则，相当于一个普通网站。
 */
const g = globalThis as unknown as Record<string, unknown>;
let store: Map<string, unknown>;
let menus: Map<string, () => unknown>;
/** 脚本管理器的 addValueChangeListener：模拟其他标签页改了设置 */
let changeListeners: Array<(k: string, o: unknown, n: unknown, remote: boolean) => void>;
const remoteChange = (value: unknown) => {
  for (const cb of changeListeners) cb('settings', undefined, structuredClone(value), true);
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function freshDocument() {
  // 换一个新的 <html>：上一个测试的遮挡实例只观察旧的根元素，不会干扰这个测试
  const html = document.createElement('html');
  html.innerHTML =
    '<head><title>Example: Arsenal 2-1 Chelsea</title></head>' +
    '<body><p id="t">Arsenal 2-1 Chelsea</p><p id="n">2026 赛季 第 3 轮 19:30</p></body>';
  document.replaceChild(html, document.documentElement);
}

async function boot(
  variant: 'sites' | 'global',
  stored?: unknown,
  fetchImpl: (url: string) => unknown = () => ({ status: 404, text: async () => '' }),
  opts: { changeListener?: boolean } = {},
) {
  vi.resetModules();
  store = new Map();
  if (stored !== undefined) store.set('settings', structuredClone(stored));
  menus = new Map();
  changeListeners = [];
  g.__SFF_WEB_URL__ = 'https://web.example/sff/';
  g.__SFF_WEB_PREFIXES__ = ['https://web.example/sff/'];
  g.__SFF_VARIANT__ = variant;
  g.GM = {
    getValue: async (k: string, d?: unknown) => (store.has(k) ? structuredClone(store.get(k)) : d),
    setValue: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    // Via、X浏览器、iOS Userscripts 没有 addValueChangeListener
    ...(opts.changeListener === false
      ? {}
      : {
          addValueChangeListener: (_k: string, cb: (typeof changeListeners)[number]) =>
            changeListeners.push(cb),
        }),
  };
  g.GM_registerMenuCommand = (name: string, fn: () => unknown) => void menus.set(name, fn);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => fetchImpl(url)),
  );
  freshDocument();
  await import('../src/main.ts');
  // 这个菜单在 runShield 最后注册（不管遮挡是否生效）
  await vi.waitFor(() => expect(menus.has('防剧透：在此站点重新启用')).toBe(true));
}

/** 面板在 shadow root 里 */
const panel = () => {
  const root = document.querySelector('sff-panel')?.shadowRoot;
  return <T extends HTMLElement = HTMLElement>(id: string) =>
    root?.querySelector(`[data-testid="${id}"]`) as T;
};
const panelStatus = () =>
  document.querySelector('sff-panel')!.shadowRoot!.querySelector('[data-id="status"]')!.textContent;
const panelTitle = () =>
  document.querySelector('sff-panel')!.shadowRoot!.querySelector('[data-id="title"]')!.textContent;

/** 网页里点开的比赛（同平台 localhost） */
const openedMatch = (id: string, home: string, away: string) => ({
  id,
  title: `${home} vs ${away}`,
  competition: 'epl',
  kickoff: '2026-09-21T00:00:00Z',
  home: { id: home.toLowerCase(), name: home },
  away: { id: away.toLowerCase(), name: away },
  url: 'http://localhost:3000/',
  host: 'localhost',
  at: Date.now(),
});

const storedSettings = () =>
  store.get('settings') as {
    global?: { enabled: boolean; start: string; end: string };
    rules?: { version: string; sites: Array<{ id: string; contextSelectors?: string[] }> };
  };

beforeEach(() => {
  // 本地时间早上 08:00，在默认的全网时段 06:00–12:00 内
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 21, 8, 0, 0));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// 最后也换掉 <html>：环境关闭时旧的遮挡实例不再收到变化通知
afterAll(() => freshDocument());

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete g.GM;
  delete g.GM_registerMenuCommand;
});

describe('全网版用户脚本', () => {
  it('刚安装（没有任何设置）时默认开启：普通网站在时段内也会遮挡比分', async () => {
    await boot('global');
    await vi.waitFor(() =>
      expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea'),
    );
    expect(document.title).toBe('Example: Arsenal ■-■ Chelsea');
    expect(document.getElementById('n')!.textContent).toBe('2026 赛季 第 3 轮 19:30');
    expect(menus.has('防剧透：关闭全网模式（当前 06:00–12:00）')).toBe(true);
  });

  it('用户关掉过的保持关闭；脚本菜单里可以重新开启', async () => {
    await boot('global', {
      global: { enabled: false, start: '06:00', end: '12:00', days: ALL_DAYS },
    });
    expect(document.getElementById('t')!.textContent).toBe('Arsenal 2-1 Chelsea');
    const open = menus.get('防剧透：开启全网模式');
    expect(open).toBeTypeOf('function');
    open!();
    await vi.waitFor(() => expect(storedSettings().global?.enabled).toBe(true));
  });

  it('脚本菜单里可以设置全网时段', async () => {
    await boot('global', {
      global: { enabled: false, start: '06:00', end: '12:00', days: ALL_DAYS },
    });
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '7:30 到 11:00'),
    );
    menus.get('防剧透：设置全网时段')!();
    await vi.waitFor(() =>
      expect(storedSettings().global).toMatchObject({
        enabled: true,
        start: '07:30',
        end: '11:00',
      }),
    );
  });

  it('手机上没有脚本菜单：悬浮面板里也能改全网时段', async () => {
    await boot('global');
    const root = document.querySelector('sff-panel')!.shadowRoot!;
    const q = <T extends HTMLElement>(id: string) =>
      root.querySelector(`[data-testid="${id}"]`) as T;
    q<HTMLButtonElement>('sff-fab').click();
    expect(q('sff-global').hidden).toBe(false);
    expect(q<HTMLInputElement>('sff-global-start').value).toBe('06:00');
    expect(q<HTMLInputElement>('sff-global-end').value).toBe('12:00');
    q<HTMLInputElement>('sff-global-start').value = '05:30';
    q<HTMLInputElement>('sff-global-end').value = '11:00';
    q<HTMLButtonElement>('sff-global-save').click();
    await vi.waitFor(() =>
      expect(storedSettings().global).toMatchObject({
        enabled: true,
        start: '05:30',
        end: '11:00',
      }),
    );
  });

  it('普通版不受影响：普通网站完全不处理', async () => {
    vi.resetModules();
    store = new Map();
    menus = new Map();
    g.__SFF_VARIANT__ = 'sites';
    g.__SFF_WEB_URL__ = 'https://web.example/sff/';
    g.__SFF_WEB_PREFIXES__ = ['https://web.example/sff/'];
    g.GM = {
      getValue: async () => undefined,
      setValue: async (k: string, v: unknown) => void store.set(k, v),
    };
    g.GM_registerMenuCommand = (name: string, fn: () => unknown) => void menus.set(name, fn);
    freshDocument();
    await import('../src/main.ts');
    await vi.waitFor(() =>
      expect(document.documentElement.classList.contains('sff-ready')).toBe(true),
    );
    expect(document.getElementById('t')!.textContent).toBe('Arsenal 2-1 Chelsea');
    expect([...menus.keys()].some((k) => k.includes('全网'))).toBe(false);
  });
});

describe('悬浮面板', () => {
  it('此站点已停用时也有面板，可以在面板里重新启用（手机上没有脚本菜单）', async () => {
    await boot('global', {
      disabledHosts: ['localhost'],
      global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS },
    });
    expect(document.getElementById('t')!.textContent).toBe('Arsenal 2-1 Chelsea');
    const q = panel();
    q('sff-fab').click();
    expect(panelStatus()).toBe('此站点已停用');
    expect(q('sff-toggle-site').textContent).toBe('在此站点启用');
    q('sff-toggle-site').click();
    await vi.waitFor(() =>
      expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea'),
    );
    expect((store.get('settings') as { disabledHosts: string[] }).disabledHosts).toEqual([]);
    await vi.waitFor(() => expect(q('sff-toggle-site').textContent).toBe('在此站点停用'));
  });

  it('面板开着时其他标签页重新启用了此站点：按钮跟着变成「在此站点停用」', async () => {
    const off = {
      disabledHosts: ['localhost'],
      global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS },
    };
    await boot('global', off);
    const q = panel();
    q('sff-fab').click();
    expect(q('sff-toggle-site').textContent).toBe('在此站点启用');
    remoteChange({ ...off, disabledHosts: [] });
    expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea');
    // 按钮还写着「启用」的话，点下去其实是停用，会把比分露出来
    expect(q('sff-toggle-site').textContent).toBe('在此站点停用');
    expect(panelStatus()).not.toBe('此站点已停用');
  });

  it('面板开着时用脚本菜单重新启用 / 停用：按钮跟着变', async () => {
    await boot('global', {
      disabledHosts: ['localhost'],
      global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS },
    });
    const q = panel();
    q('sff-fab').click();
    expect(q('sff-toggle-site').textContent).toBe('在此站点启用');
    await menus.get('防剧透：在此站点重新启用')!();
    await vi.waitFor(() => expect(q('sff-toggle-site').textContent).toBe('在此站点停用'));
    expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea');
    expect(panelStatus()).not.toBe('此站点已停用');
    await menus.get('防剧透：在此站点停用')!();
    await vi.waitFor(() => expect(q('sff-toggle-site').textContent).toBe('在此站点启用'));
    expect(panelStatus()).toBe('此站点已停用');
  });

  it('其他标签页打开了总开关：不刷新也补上面板', async () => {
    const off = {
      enabled: false,
      global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS },
    };
    await boot('global', off);
    expect(document.querySelector('sff-panel')).toBeNull();
    remoteChange({ ...off, enabled: true });
    expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea');
    expect(document.querySelector('sff-panel')).not.toBeNull();
  });

  it('全网时段结束后页面还遮着：面板说明保持到刷新，临时显示照常可用', async () => {
    const s = { global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS } };
    await boot('global', s);
    await vi.waitFor(() =>
      expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea'),
    );
    // 时段结束后的一次设置变化（每分钟的时段检查走同一条路）
    vi.setSystemTime(new Date(2026, 8, 21, 12, 30, 0));
    remoteChange(s);
    expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea');
    const q = panel();
    q('sff-fab').click();
    expect(panelStatus()).toBe('全网时段已结束，这个页面的遮挡保持到刷新');
    expect(q('sff-pause').hidden).toBe(false);
    q('sff-pause').click();
    expect(document.getElementById('t')!.textContent).toBe('Arsenal 2-1 Chelsea');
    expect(panelStatus()).toBe('已临时显示');
    expect(q('sff-resume').hidden).toBe(false);
  });

  it('全网模式在别的标签页关掉：这个页面立即解除遮挡', async () => {
    const s = { global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS } };
    await boot('global', s);
    await vi.waitFor(() =>
      expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea'),
    );
    remoteChange({ global: { ...s.global, enabled: false } });
    expect(document.getElementById('t')!.textContent).toBe('Arsenal 2-1 Chelsea');
    panel()('sff-fab').click();
    expect(panelStatus()).toBe('全网模式已关闭');
  });

  it('比分加载失败（5xx）：说明可以再试一次，点「再试一次」直接重新下载', async () => {
    let scoreCalls = 0;
    await boot(
      'global',
      {
        global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS },
        currentMatch: {
          id: 'epl-x',
          title: 'Arsenal vs Chelsea',
          competition: 'epl',
          kickoff: '2026-09-21T00:00:00Z',
          home: { id: 'ars', name: 'Arsenal' },
          away: { id: 'che', name: 'Chelsea' },
          url: 'http://localhost:3000/',
          host: 'localhost',
          at: Date.now(),
        },
      },
      (url) => {
        if (!url.includes('/scores/')) return { status: 404, text: async () => '' };
        scoreCalls++;
        return scoreCalls === 1
          ? { status: 503, text: async () => '<html>Service Unavailable</html>' }
          : { status: 200, text: async () => JSON.stringify({ id: 'epl-x', home: 2, away: 1 }) };
      },
    );
    const q = panel();
    q('sff-fab').click();
    q('sff-reveal').click();
    q('sff-reveal-yes').click();
    await vi.waitFor(() =>
      expect(q('sff-score').textContent).toBe('比分加载失败：HTTP 503（已记为已看，可以再试一次）'),
    );
    expect(q('sff-reveal').hidden).toBe(false);
    expect(q('sff-reveal').textContent).toBe('再试一次');
    q('sff-reveal').click();
    expect(q('sff-reveal-yes').hidden).toBe(true);
    await vi.waitFor(() => expect(q('sff-score').textContent).toBe('Arsenal 2 - 1 Chelsea'));
    expect(scoreCalls).toBe(2);
  });

  it('加载失败后其他标签页换了一场：面板先换成新比赛，「再试一次」不会直接显示新比赛的比分', async () => {
    let scoreCalls = 0;
    await boot(
      'global',
      {
        global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS },
        currentMatch: openedMatch('epl-a', 'Arsenal', 'Chelsea'),
      },
      (url) => {
        if (!url.includes('/scores/')) return { status: 404, text: async () => '' };
        scoreCalls++;
        if (scoreCalls === 1) return { status: 503, text: async () => 'Service Unavailable' };
        const id = url.endsWith(scorePath('epl-b')) ? 'epl-b' : 'epl-a';
        return { status: 200, text: async () => JSON.stringify({ id, home: 4, away: 0 }) };
      },
    );
    const q = panel();
    q('sff-fab').click();
    q('sff-reveal').click();
    q('sff-reveal-yes').click();
    await vi.waitFor(() => expect(q('sff-reveal').textContent).toBe('再试一次'));
    // 网页（另一个标签页）打开了同平台的另一场
    remoteChange({
      ...(store.get('settings') as object),
      currentMatch: openedMatch('epl-b', 'Liverpool', 'Everton'),
    });
    expect(panelTitle()).toBe('Liverpool vs Everton');
    expect(q('sff-reveal').hidden).toBe(false);
    expect(q('sff-reveal').textContent).toBe('看完了，显示比分');
    expect(q('sff-score').textContent).toBe('');
    // 新的一场还没看：要先确认
    q('sff-reveal').click();
    expect(q('sff-reveal-yes').hidden).toBe(false);
    const scoreUrls = () =>
      vi
        .mocked(fetch)
        .mock.calls.map(([u]) => String(u))
        .filter((u) => u.endsWith(scorePath('epl-b')));
    expect(scoreUrls()).toEqual([]);
    q('sff-reveal-yes').click();
    await vi.waitFor(() => expect(q('sff-score').textContent).toBe('Liverpool 4 - 0 Everton'));
    expect(panelTitle()).toBe('Liverpool vs Everton');
    expect(scoreUrls()).toHaveLength(1);
  });
});

describe('站点规则更新', () => {
  it('远程规则内容变了但 version 没改大：也会采用', async () => {
    const remote = structuredClone(DEFAULT_SITE_RULES_JSON) as typeof DEFAULT_SITE_RULES_JSON;
    remote.sites[0]!.contextSelectors = [
      ...(remote.sites[0]!.contextSelectors ?? []),
      '.my-fixed-selector',
    ];
    expect(remote.version).toBe(DEFAULT_SITE_RULES_JSON.version);
    expect(validateSiteRules(remote)).not.toBeNull();
    await boot('global', undefined, (url) =>
      url.endsWith('site-rules.json')
        ? { status: 200, text: async () => JSON.stringify(remote) }
        : { status: 404, text: async () => '' },
    );
    await vi.waitFor(() =>
      expect(storedSettings().rules?.sites[0]?.contextSelectors).toContain('.my-fixed-selector'),
    );
  });

  it('比当前旧的远程规则不采用', async () => {
    const remote = structuredClone(DEFAULT_SITE_RULES_JSON) as typeof DEFAULT_SITE_RULES_JSON;
    remote.version = '2000-01-01';
    remote.sites[0]!.contextSelectors = ['.old-selector'];
    await boot('global', undefined, (url) =>
      url.endsWith('site-rules.json')
        ? { status: 200, text: async () => JSON.stringify(remote) }
        : { status: 404, text: async () => '' },
    );
    await vi.waitFor(() => expect(store.get('settings')).toBeDefined());
    expect(storedSettings().rules).toBeUndefined();
  });
});

describe('没有 addValueChangeListener 的脚本管理器（Via、X浏览器、iOS Userscripts）', () => {
  const stored = () =>
    store.get('settings') as {
      watched?: Record<string, number>;
      disabledHosts?: string[];
      rulesCheckedAt?: number;
    };
  const ready = () => vi.waitFor(() => expect(stored().rulesCheckedAt).toBeDefined());

  it('显示比分时不会把其他标签页记下的「已看」覆盖掉', async () => {
    await boot(
      'global',
      {
        global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS },
        currentMatch: openedMatch('epl-y', 'Arsenal', 'Chelsea'),
      },
      undefined,
      { changeListener: false },
    );
    await ready();
    // 另一个标签页在这之后记下了 X 已看（没有监听器，这里内存里的设置不知道）
    stored().watched = { 'epl-x': 1 };
    const q = panel();
    q('sff-fab').click();
    q('sff-reveal').click();
    q('sff-reveal-yes').click();
    await vi.waitFor(() => expect(stored().watched).toHaveProperty('epl-y'));
    expect(stored().watched).toHaveProperty('epl-x');
  });

  it('在此站点停用时不会把其他标签页停用的站点覆盖掉', async () => {
    await boot(
      'global',
      { global: { enabled: true, start: '06:00', end: '12:00', days: ALL_DAYS } },
      undefined,
      { changeListener: false },
    );
    await ready();
    stored().disabledHosts = ['example.com'];
    const q = panel();
    q('sff-fab').click();
    q('sff-toggle-site').click();
    await vi.waitFor(() => expect(stored().disabledHosts).toContain('localhost'));
    expect(stored().disabledHosts).toContain('example.com');
  });
});

describe('防剧透网页上的联动', () => {
  /** 脚本管理器沙箱里的 unsafeWindow（Tampermonkey 里脚本看到的 window 是个包装，不是页面的 window） */
  const unsafe = {};

  async function bootBridge() {
    vi.resetModules();
    store = new Map();
    menus = new Map();
    changeListeners = [];
    g.__SFF_WEB_URL__ = 'http://localhost:3000/';
    g.__SFF_WEB_PREFIXES__ = ['http://localhost:3000/'];
    g.__SFF_VARIANT__ = 'sites';
    g.unsafeWindow = unsafe;
    g.GM = {
      getValue: async (k: string, d?: unknown) =>
        store.has(k) ? structuredClone(store.get(k)) : d,
      setValue: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    };
    freshDocument();
    await import('../src/main.ts');
    await vi.waitFor(() => expect(document.documentElement.dataset.sffShield).toBe('userscript'));
  }
  const openMatch = (source: unknown, origin = location.origin) =>
    new MessageEvent('message', {
      data: {
        source: 'sff-web',
        type: 'open-match',
        url: 'https://www.bilibili.com/video/BV1xx',
        match: { ...openedMatch('epl-a', 'Arsenal', 'Chelsea'), url: undefined },
      },
      origin,
      source: source as Window,
    });
  const storedMatch = () =>
    (store.get('settings') as { currentMatch?: { id: string } } | undefined)?.currentMatch;

  afterEach(() => {
    delete g.unsafeWindow;
  });

  it('沙箱里页面发来的消息 source 是 unsafeWindow 而不是脚本的 window：也要处理', async () => {
    await bootBridge();
    window.dispatchEvent(openMatch(unsafe));
    await vi.waitFor(() => expect(storedMatch()?.id).toBe('epl-a'));
  });

  it('来源不是本页面（别的 window 或别的源）的消息不处理', async () => {
    await bootBridge();
    window.dispatchEvent(openMatch({}));
    window.dispatchEvent(openMatch(unsafe, 'https://evil.example'));
    await new Promise((r) => setTimeout(r, 20));
    expect(storedMatch()).toBeUndefined();
  });
});

describe('时段输入解析', () => {
  it('支持常见写法，拒绝不合法的时间', () => {
    expect(parseTimeWindow('06:00-12:00')).toEqual({ start: '06:00', end: '12:00' });
    expect(parseTimeWindow(' 22：00 ~ 8:05 ')).toEqual({ start: '22:00', end: '08:05' });
    expect(parseTimeWindow('00:00到00:00')).toEqual({ start: '00:00', end: '00:00' });
    expect(parseTimeWindow('25:00-12:00')).toBeNull();
    expect(parseTimeWindow('06:00')).toBeNull();
    expect(parseTimeWindow('早上')).toBeNull();
  });
});
