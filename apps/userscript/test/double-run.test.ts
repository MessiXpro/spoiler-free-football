// @vitest-environment-options { "url": "https://video.example.net/watch/1" }
import { DEFAULT_SITE_RULES_JSON } from '@sff/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 同一个页面上跑了两份脚本（普通版 + 全网版，或插件 + 脚本）：两份各有自己的 MutationObserver，
 * 一份「临时显示」把原文写回去，另一份立刻又遮回去，而且会出现两个「防」按钮。只能有一份启动。
 */
const g = globalThis as unknown as Record<string, unknown>;
const store = new Map<string, unknown>();

/** 像 B 站那样有站点规则的网站（jsdom 地址是 video.example.net） */
const rules = {
  ...DEFAULT_SITE_RULES_JSON,
  version: '9999-01-01',
  sites: [
    ...DEFAULT_SITE_RULES_JSON.sites,
    { id: 'test-site', name: '测试站', hosts: ['video.example.net'], context: 'always' },
  ],
};

async function run(variant: 'sites' | 'global') {
  vi.resetModules();
  g.__SFF_WEB_URL__ = 'https://web.example/sff/';
  g.__SFF_WEB_PREFIXES__ = ['https://web.example/sff/'];
  g.__SFF_VARIANT__ = variant;
  g.GM = {
    getValue: async (k: string, d?: unknown) => (store.has(k) ? structuredClone(store.get(k)) : d),
    setValue: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
  };
  g.GM_registerMenuCommand = () => {};
  await import('../src/main.ts');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete g.GM;
  delete g.GM_registerMenuCommand;
});

describe('同一页面只跑一份', () => {
  it('普通版已在防剧透的页面上再运行全网版：第二份不启动，「临时显示」能真的显示出来', async () => {
    store.set('settings', { rules });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 404, text: async () => '' })),
    );
    document.body.innerHTML = '<h1 id="t">Arsenal 2-1 Chelsea</h1>';
    await run('sites');
    await vi.waitFor(() =>
      expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea'),
    );
    expect(document.documentElement.dataset.sffActive).toBe('userscript-sites');

    // 不换 <html>：同一个页面上再来一份全网版
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await run('global');
    await vi.waitFor(() => expect(info).toHaveBeenCalled());
    expect(document.querySelectorAll('sff-panel').length).toBe(1);
    expect(document.documentElement.dataset.sffActive).toBe('userscript-sites');

    const root = document.querySelector('sff-panel')!.shadowRoot!;
    const q = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    q('sff-fab').click();
    q('sff-pause').click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('t')!.textContent).toBe('Arsenal 2-1 Chelsea');
    expect(root.querySelector('[data-id="status"]')!.textContent).toBe('已临时显示');
  });

  it('先到的那份在此站点停用：不占用页面，另一份照常遮挡', async () => {
    const html = document.createElement('html');
    html.innerHTML = '<head></head><body><h1 id="t">Arsenal 2-1 Chelsea</h1></body>';
    document.replaceChild(html, document.documentElement);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 404, text: async () => '' })),
    );
    // 两版脚本的存储各自独立：普通版里停用了这个站点，全网版没有
    store.set('settings', { rules, disabledHosts: ['video.example.net'] });
    await run('sites');
    await new Promise((r) => setTimeout(r, 20));
    expect(document.documentElement.dataset.sffActive).toBeUndefined();
    store.set('settings', { rules });
    await run('global');
    await vi.waitFor(() =>
      expect(document.getElementById('t')!.textContent).toBe('Arsenal ■-■ Chelsea'),
    );
    expect(document.documentElement.dataset.sffActive).toBe('userscript-global');
  });
});
