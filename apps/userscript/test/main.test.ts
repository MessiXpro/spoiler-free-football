import { DEFAULT_SITE_RULES_JSON, validateSiteRules } from '@sff/core';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTimeWindow } from '../src/schedule.ts';

/**
 * 在 jsdom 里加载整个用户脚本（main.ts 导入时就会运行），模拟脚本管理器的 GM 存储和菜单。
 * jsdom 的地址是 http://localhost:3000/：没有站点规则，相当于一个普通网站。
 */
const g = globalThis as unknown as Record<string, unknown>;
let store: Map<string, unknown>;
let menus: Map<string, () => unknown>;

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
) {
  vi.resetModules();
  store = new Map();
  if (stored !== undefined) store.set('settings', structuredClone(stored));
  menus = new Map();
  g.__SFF_WEB_URL__ = 'https://web.example/sff/';
  g.__SFF_WEB_PREFIXES__ = ['https://web.example/sff/'];
  g.__SFF_VARIANT__ = variant;
  g.GM = {
    getValue: async (k: string, d?: unknown) => (store.has(k) ? structuredClone(store.get(k)) : d),
    setValue: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
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
