// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://video.example.net/watch/1" }
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_RULES_JSON } from '@sff/core';
import { installChromeMock, removeChromeMock } from './chrome-mock.ts';

const g = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  removeChromeMock();
  delete g.__SFF_WEB_MATCHES__;
  delete g.__sffGlobal;
});

describe('全网脚本注入的页面在下载来的规则里已有站点时，按站点模式工作', () => {
  it('全网模式关着、但规则里有本站：照样遮挡（和用户脚本一致）', async () => {
    vi.resetModules();
    installChromeMock({
      global: { enabled: false, start: '00:00', end: '00:00', days: [0, 1, 2, 3, 4, 5, 6] },
      rules: {
        ...DEFAULT_SITE_RULES_JSON,
        version: '9999-01-01',
        sites: [
          ...DEFAULT_SITE_RULES_JSON.sites,
          { id: 'test-site', name: '测试站', hosts: ['video.example.net'], context: 'always' },
        ],
      },
    });
    g.__SFF_WEB_MATCHES__ = ['https://example.invalid/*'];
    g.__sffGlobal = true;
    document.documentElement.className = '';
    document.body.innerHTML = '<span id="score">曼联 2 - 1 利物浦</span>';
    await import('../src/content.ts');
    await vi.waitFor(() =>
      expect(document.documentElement.classList.contains('sff-ready')).toBe(true),
    );
    await vi.waitFor(() => expect(document.getElementById('score')!.textContent).toContain('■'));
  });
});
