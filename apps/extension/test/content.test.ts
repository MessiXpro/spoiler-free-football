// @vitest-environment jsdom
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, removeChromeMock } from './chrome-mock.ts';
import { isWebAppUrl, matchesPattern } from '../src/web-match.ts';

/** jsdom 的地址是 http://localhost:3000/（本地开发时的防剧透网页也是 localhost） */
const g = globalThis as unknown as Record<string, unknown>;
const ALL_DAY = { enabled: true, start: '00:00', end: '00:00', days: [0, 1, 2, 3, 4, 5, 6] };

function freshDocument() {
  // 换一个新的 <html>：上一个测试的遮挡实例只观察旧的根元素
  const html = document.createElement('html');
  html.innerHTML =
    '<head><title>比赛 · 防剧透看球</title></head><body><span id="score">曼联 2 - 1 利物浦</span></body>';
  document.replaceChild(html, document.documentElement);
}

async function runGlobalContentScript(webMatches: string[]) {
  vi.resetModules();
  installChromeMock({ global: ALL_DAY });
  g.__SFF_WEB_MATCHES__ = webMatches;
  // 全网模式：后台注册的 global-flag.js 先运行
  g.__sffGlobal = true;
  freshDocument();
  await import('../src/content.ts');
  await vi.waitFor(() =>
    expect(document.documentElement.classList.contains('sff-ready')).toBe(true),
  );
}

afterAll(() => freshDocument());

afterEach(() => {
  removeChromeMock();
  delete g.__SFF_WEB_MATCHES__;
  delete g.__sffGlobal;
});

describe('全网模式的内容脚本', () => {
  it('对照：普通网站在时段内会遮挡比分', async () => {
    await runGlobalContentScript(['https://football.example.cn/*']);
    await vi.waitFor(() => expect(document.getElementById('score')!.textContent).toContain('■'));
  });

  it('防剧透网页本身不处理：「看完了，显示比分」显示的比分保持可读', async () => {
    await runGlobalContentScript(['http://localhost/*']);
    expect(document.documentElement.classList.contains('sff-on')).toBe(false);
    // React 显示比分（分成几个文字节点）之后也不处理
    const li = document.createElement('li');
    li.append('半场 ', '1', ' - ', '0');
    document.body.append(li);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('score')!.textContent).toBe('曼联 2 - 1 利物浦');
    expect(li.textContent).toBe('半场 1 - 0');
    expect(li.hasAttribute('data-sff-hide')).toBe(false);
  });
});

describe('页面上已有用户脚本在防剧透', () => {
  it('插件不再启动第二份（两份会互相把对方「临时显示」的内容遮回去）；弹窗问状态时说明原因', async () => {
    vi.resetModules();
    const { mock } = installChromeMock({ global: ALL_DAY });
    g.__SFF_WEB_MATCHES__ = ['https://football.example.cn/*'];
    g.__sffGlobal = true;
    freshDocument();
    // 用户脚本先到，已经在这个页面上接管
    document.documentElement.dataset.sffActive = 'userscript-sites';
    await import('../src/content.ts');
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById('score')!.textContent).toBe('曼联 2 - 1 利物浦');
    expect(document.documentElement.dataset.sffActive).toBe('userscript-sites');
    const reply = vi.fn();
    for (const fn of mock.runtime.onMessage.listeners) {
      (fn as (...a: unknown[]) => unknown)({ type: 'status' }, {}, reply);
    }
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, reason: expect.stringContaining('用户脚本') }),
    );
  });
});

describe('插件关着 / 此站点停用', () => {
  for (const settings of [{ enabled: false }, { disabledHosts: ['localhost'] }]) {
    it(`不占用页面，同时装着的用户脚本照常接手：${JSON.stringify(settings)}`, async () => {
      vi.resetModules();
      installChromeMock(settings);
      g.__SFF_WEB_MATCHES__ = ['https://football.example.cn/*'];
      freshDocument();
      await import('../src/content.ts');
      await vi.waitFor(() =>
        expect(document.documentElement.classList.contains('sff-ready')).toBe(true),
      );
      expect(document.documentElement.dataset.sffActive).toBeUndefined();
    });
  }
});

describe('match pattern', () => {
  it('和浏览器一样忽略端口，按路径前缀匹配', () => {
    expect(matchesPattern('http://localhost:5173/#/match/x', 'http://localhost/*')).toBe(true);
    expect(
      matchesPattern(
        'https://messixpro.github.io/spoiler-free-football/#/match/x',
        'https://messixpro.github.io/spoiler-free-football/*',
      ),
    ).toBe(true);
    expect(
      matchesPattern(
        'https://messixpro.github.io/other-project/',
        'https://messixpro.github.io/spoiler-free-football/*',
      ),
    ).toBe(false);
    expect(matchesPattern('https://www.bilibili.com/video/x', '*://*.bilibili.com/*')).toBe(true);
    expect(matchesPattern('https://bilibili.com/', '*://*.bilibili.com/*')).toBe(true);
    expect(matchesPattern('https://notbilibili.com/', '*://*.bilibili.com/*')).toBe(false);
    expect(matchesPattern('http://localhost/', 'https://localhost/*')).toBe(false);
    expect(isWebAppUrl('https://football.example.cn/', ['https://football.example.cn/*'])).toBe(
      true,
    );
    expect(isWebAppUrl('https://news.example.com/', ['https://football.example.cn/*'])).toBe(false);
  });
});
