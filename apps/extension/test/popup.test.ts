// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabStatus } from '../src/api.ts';
import { installChromeMock, removeChromeMock } from './chrome-mock.ts';

const html = readFileSync(join(import.meta.dirname, '..', 'static', 'popup.html'), 'utf8');

const MATCH = {
  id: 'epl-2026-x',
  title: '曼联 vs 利物浦',
  competition: 'epl',
  kickoff: '2026-10-17T12:00:00Z',
  home: { id: 'mu', name: '曼联' },
  away: { id: 'liv', name: '利物浦' },
  url: 'https://www.miguvideo.com/p/x',
  host: 'www.miguvideo.com',
  at: Date.now(),
};

const status = (patch: Partial<TabStatus>): TabStatus => ({
  active: true,
  site: null,
  football: true,
  texts: 3,
  blocks: 1,
  paused: false,
  currentMatch: null,
  ...patch,
});

/** 打开弹窗：当前标签页的内容脚本按 reply 回复状态 */
async function openPopup(reply: (msg: { type: string }) => TabStatus) {
  vi.resetModules();
  const chromeMock = installChromeMock();
  const sendMessage = vi.fn(async (_id: number, msg: { type: string }) => reply(msg));
  (chromeMock.mock as unknown as { tabs: unknown }).tabs = {
    query: async () => [{ id: 7, url: 'https://news.example.com/a' }],
    get: async () => ({ id: 7, url: 'https://news.example.com/a' }),
    sendMessage,
    create: vi.fn(),
  };
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/
    .exec(html)![1]!
    .replace(/<script[\s\S]*?<\/script>/g, '');
  await import('../src/popup.ts');
  await vi.waitFor(() => expect($('site-status').textContent).not.toBe('读取中…'));
  return { ...chromeMock, sendMessage };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

afterEach(() => {
  removeChromeMock();
  vi.unstubAllGlobals();
});

describe('插件弹窗', () => {
  it('全网时段结束、页面还遮着：说明保持到刷新，临时显示照常可用', async () => {
    let paused = false;
    const { sendMessage } = await openPopup((msg) => {
      if (msg.type === 'pause') paused = true;
      if (msg.type === 'resume') paused = false;
      return status({ active: false, holding: true, reason: '不在全网防剧透时段', paused });
    });
    expect($('site-status').textContent).toBe(
      'news.example.com：全网时段已结束，这个页面的遮挡保持到刷新',
    );
    expect($('pause').hidden).toBe(false);
    expect($('resume').hidden).toBe(true);

    $('pause').click();
    await vi.waitFor(() =>
      expect($('site-status').textContent).toBe('news.example.com：已临时显示全部内容'),
    );
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'pause', ms: 5 * 60 * 1000 });
    expect($('pause').hidden).toBe(true);
    expect($('resume').hidden).toBe(false);
  });

  it('不工作的页面仍然隐藏临时显示按钮', async () => {
    await openPopup(() => status({ active: false, reason: '全网模式已关闭' }));
    expect($('site-status').textContent).toBe('news.example.com：全网模式已关闭');
    expect($('pause').hidden).toBe(true);
    expect($('resume').hidden).toBe(true);
  });

  it('比分加载失败后点「再试一次」直接重新下载，不再问「会记为已看」', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ id: MATCH.id, home: 2, away: 1 }), { status: 200 });
      }),
    );
    const { store } = await openPopup(() => status({ currentMatch: MATCH }));
    expect($('match-card').hidden).toBe(false);

    $('reveal').click();
    expect($('reveal-confirm').hidden).toBe(false);
    $('reveal-yes').click();
    await vi.waitFor(() => expect($('match-score').textContent).toContain('比分加载失败'));
    expect($('reveal').textContent).toBe('再试一次');
    expect($('reveal').hidden).toBe(false);
    expect((store.settings as { watched: Record<string, number> }).watched[MATCH.id]).toBeTypeOf(
      'number',
    );

    $('reveal').click();
    expect($('reveal-confirm').hidden).toBe(true);
    await vi.waitFor(() => expect($('match-score').textContent).toBe('曼联 2 - 1 利物浦'));
    expect(calls).toBe(2);
  });
});
