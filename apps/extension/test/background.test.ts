import { DEFAULT_SITE_RULES_JSON } from '@sff/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, removeChromeMock } from './chrome-mock.ts';

const g = globalThis as unknown as Record<string, unknown>;
const SITE = ['*://*.bilibili.com/*', '*://*.miguvideo.com/*'];
const WEB = ['https://football.example.cn/*', 'http://localhost/*'];
const ALL_DAY = { enabled: true, start: '00:00', end: '00:00', days: [0, 1, 2, 3, 4, 5, 6] };

async function loadBackground() {
  vi.resetModules();
  g.__SFF_SITE_MATCHES__ = SITE;
  g.__SFF_WEB_MATCHES__ = WEB;
  await import('../src/background.ts');
}

const fire = async (ev: { listeners: Array<(...a: never[]) => unknown> }) => {
  for (const fn of ev.listeners) (fn as () => unknown)();
};

beforeEach(() => {
  // 默认离线：规则下载失败，不写设置
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeChromeMock();
  delete g.__SFF_SITE_MATCHES__;
  delete g.__SFF_WEB_MATCHES__;
});

describe('全网防剧透的动态内容脚本', () => {
  it('排除支持的站点和防剧透网页本身（网页上显示出来的比分不能再被遮住）', async () => {
    const { mock, registered } = installChromeMock({ global: ALL_DAY });
    await loadBackground();
    await fire(mock.runtime.onInstalled);
    await vi.waitFor(() => expect(registered).toHaveLength(1));
    expect(registered[0]!.matches).toEqual(['<all_urls>']);
    expect(registered[0]!.excludeMatches).toEqual(expect.arrayContaining([...SITE, ...WEB]));
  });

  it('插件更新前注册的旧脚本（没有排除网页）会按新配置更新', async () => {
    const { mock, registered } = installChromeMock({ global: ALL_DAY });
    registered.push({
      id: 'sff-global',
      matches: ['<all_urls>'],
      excludeMatches: SITE,
      js: ['global-flag.js', 'content.js'],
      css: ['cloak.css'],
      runAt: 'document_start',
      allFrames: false,
    });
    await loadBackground();
    await fire(mock.runtime.onInstalled);
    await vi.waitFor(() => expect(mock.scripting.updateContentScripts).toHaveBeenCalled());
    expect(registered).toHaveLength(1);
    expect(registered[0]!.excludeMatches).toEqual(expect.arrayContaining([...SITE, ...WEB]));
  });

  it('已经是最新配置时不重复更新；关闭全网模式后注销', async () => {
    const { mock, registered, store } = installChromeMock({ global: ALL_DAY });
    await loadBackground();
    await fire(mock.runtime.onInstalled);
    await vi.waitFor(() => expect(registered).toHaveLength(1));
    await fire(mock.runtime.onStartup);
    await new Promise((r) => setTimeout(r, 10));
    expect(mock.scripting.updateContentScripts).not.toHaveBeenCalled();
    await chrome.storage.local.set({
      settings: { ...(store.settings as object), global: { ...ALL_DAY, enabled: false } },
    });
    await vi.waitFor(() => expect(registered).toHaveLength(0));
  });
});

describe('站点规则更新', () => {
  const remoteWith = (patch: (doc: typeof DEFAULT_SITE_RULES_JSON) => void) => {
    const doc = structuredClone(DEFAULT_SITE_RULES_JSON) as typeof DEFAULT_SITE_RULES_JSON;
    patch(doc);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(doc), { status: 200 })),
    );
  };
  const storedRules = (store: Record<string, unknown>) =>
    (store.settings as { rules?: { sites: Array<{ contextSelectors?: string[] }> } } | undefined)
      ?.rules;

  it('内容改了但 version 没改大：已安装的插件也会采用', async () => {
    remoteWith((doc) => {
      doc.sites[0]!.contextSelectors = [...(doc.sites[0]!.contextSelectors ?? []), '.my-fix'];
    });
    const { mock, store } = installChromeMock();
    await loadBackground();
    await fire(mock.runtime.onInstalled);
    await vi.waitFor(() =>
      expect(storedRules(store)?.sites[0]?.contextSelectors).toContain('.my-fix'),
    );
  });

  it('比当前旧的规则不采用', async () => {
    remoteWith((doc) => {
      doc.version = '2000-01-01';
      doc.sites[0]!.contextSelectors = ['.old'];
    });
    const { mock, store } = installChromeMock();
    await loadBackground();
    await fire(mock.runtime.onInstalled);
    await vi.waitFor(() =>
      expect(
        (store.settings as { rulesCheckedAt?: number } | undefined)?.rulesCheckedAt,
      ).toBeTypeOf('number'),
    );
    expect(storedRules(store)).toBeUndefined();
  });
});
