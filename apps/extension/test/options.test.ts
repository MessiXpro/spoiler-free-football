// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_RULES_JSON } from '@sff/core';
import { installChromeMock, removeChromeMock } from './chrome-mock.ts';

const g = globalThis as unknown as Record<string, unknown>;
const html = readFileSync(join(import.meta.dirname, '..', 'static', 'options.html'), 'utf8');

async function openOptions(initialSettings?: unknown) {
  vi.resetModules();
  const chromeMock = installChromeMock(initialSettings);
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/
    .exec(html)![1]!
    .replace(/<script[\s\S]*?<\/script>/g, '');
  await import('../src/options.ts');
  const start = document.getElementById('global-start') as HTMLInputElement;
  await vi.waitFor(() => expect(start.value).toBe('06:00'));
  return chromeMock;
}

const change = (el: HTMLInputElement, apply: (el: HTMLInputElement) => void) => {
  apply(el);
  el.dispatchEvent(new Event('change'));
};

afterEach(() => {
  removeChromeMock();
  delete g.__SFF_SITE_MATCHES__;
});

describe('设置页：全网防剧透时段', () => {
  it('清空结束时间（存进去会被当成 00:00、遮到半夜）：恢复原来的值并提示', async () => {
    const { store } = await openOptions();
    const stored = () => (store.settings as { global: { start: string; end: string } }).global;
    const start = document.getElementById('global-start') as HTMLInputElement;
    const end = document.getElementById('global-end') as HTMLInputElement;
    change(start, (el) => (el.value = '07:00'));
    await vi.waitFor(() => expect(stored().start).toBe('07:00'));
    change(end, (el) => (el.value = ''));
    await vi.waitFor(() => expect(end.value).toBe('12:00'));
    expect(stored().end).toBe('12:00');
    expect(document.getElementById('global-msg')!.textContent).toContain('恢复');
    // 页面上说明跨午夜和全天的写法
    expect(document.body.textContent).toContain('跨午夜');
  });

  it('先改开始时间、再改结束时间、勾选星期、开启：之前改的值都保留', async () => {
    const { store } = await openOptions();
    const stored = () =>
      (
        store.settings as {
          global: { enabled: boolean; start: string; end: string; days: number[] };
        }
      ).global;
    const start = document.getElementById('global-start') as HTMLInputElement;
    const end = document.getElementById('global-end') as HTMLInputElement;

    change(start, (el) => (el.value = '22:00'));
    await vi.waitFor(() => expect(stored().start).toBe('22:00'));
    change(end, (el) => (el.value = '08:00'));
    await vi.waitFor(() => expect(stored().end).toBe('08:00'));
    expect(stored().start).toBe('22:00');

    const sunday = document.querySelector('#global-days input') as HTMLInputElement;
    change(sunday, (el) => (el.checked = false));
    await vi.waitFor(() => expect(stored().days).toEqual([1, 2, 3, 4, 5, 6]));
    expect(stored()).toMatchObject({ start: '22:00', end: '08:00' });

    change(
      document.getElementById('global-enabled') as HTMLInputElement,
      (el) => (el.checked = true),
    );
    await vi.waitFor(() => expect(stored().enabled).toBe(true));
    expect(stored()).toMatchObject({ start: '22:00', end: '08:00', days: [1, 2, 3, 4, 5, 6] });
  });

  it('连续快速修改也不会互相覆盖', async () => {
    const { store } = await openOptions();
    const start = document.getElementById('global-start') as HTMLInputElement;
    const end = document.getElementById('global-end') as HTMLInputElement;
    change(start, (el) => (el.value = '21:00'));
    change(end, (el) => (el.value = '09:00'));
    await vi.waitFor(() =>
      expect((store.settings as { global: object } | undefined)?.global).toMatchObject({
        start: '21:00',
        end: '09:00',
      }),
    );
  });
});

describe('设置页：站点规则', () => {
  // 构建时注入的、这个版本插件有权限的站点（manifest 里的 content_scripts.matches / host_permissions）
  const builtHosts = [...new Set(DEFAULT_SITE_RULES_JSON.sites.flatMap((s) => s.hosts))];
  const withNewSite = (globalEnabled: boolean) => ({
    global: { enabled: globalEnabled, start: '06:00', end: '12:00', days: [0, 1, 2, 3, 4, 5, 6] },
    rules: {
      ...DEFAULT_SITE_RULES_JSON,
      version: '9999-01-01',
      sites: [
        ...DEFAULT_SITE_RULES_JSON.sites,
        { id: 'new-site', name: '新站', hosts: ['douyin.com'], context: 'always' },
      ],
    },
  });

  it('下载来的规则里新增了站点、但这个版本的插件没有它的权限：说明要重新安装或开全网防剧透', async () => {
    g.__SFF_SITE_MATCHES__ = builtHosts.map((h) => `*://*.${h}/*`);
    await openOptions(withNewSite(false));
    const info = document.getElementById('rules-info')!.textContent!;
    expect(info).toContain('douyin.com');
    expect(info).toContain('重新安装');
  });

  it('已开启全网防剧透：全网脚本会按站点规则处理新站点，不用提示', async () => {
    g.__SFF_SITE_MATCHES__ = builtHosts.map((h) => `*://*.${h}/*`);
    await openOptions(withNewSite(true));
    expect(document.getElementById('rules-info')!.textContent).not.toContain('douyin.com');
  });
});
