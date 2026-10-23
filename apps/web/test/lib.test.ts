import { describe, expect, it, vi } from 'vitest';
import { href, parseHash } from '../src/lib/router.ts';
import { describeDataError } from '../src/lib/data.ts';
import { notifyOpenMatch } from '../src/lib/bridge.ts';
import { detectDevice } from '../src/views/SettingsView.tsx';
import { bilibiliEmbedUrl } from '../src/components/Embed.tsx';

describe('路由', () => {
  it('解析各个页面', () => {
    expect(parseHash('')).toEqual({ name: 'today', offset: 0 });
    expect(parseHash('#/today/-2')).toEqual({ name: 'today', offset: -2 });
    expect(parseHash('#/today/-999')).toEqual({ name: 'today', offset: -30 });
    expect(parseHash('#/programs')).toEqual({ name: 'programs' });
    expect(parseHash('#/match/epl-2026-27-a-b')).toEqual({ name: 'match', id: 'epl-2026-27-a-b' });
    expect(parseHash('#/import/SFF1.abc_-')).toEqual({ name: 'import', code: 'SFF1.abc_-' });
    expect(parseHash('#/nonsense')).toEqual({ name: 'today', offset: 0 });
  });
  it('手改/截断的链接里有不完整的 %xx 时不崩溃', () => {
    expect(() => parseHash('#/match/100%')).not.toThrow();
    expect(parseHash('#/match/100%')).toEqual({ name: 'match', id: '100%' });
    expect(parseHash('#/match/abc%E0%A4%A')).toEqual({ name: 'match', id: 'abc%E0%A4%A' });
    expect(parseHash('#/match/a%25b')).toEqual({ name: 'match', id: 'a%b' });
  });
  it('生成链接', () => {
    expect(href({ name: 'today', offset: 0 })).toBe('#/today');
    expect(href({ name: 'today', offset: -1 })).toBe('#/today/-1');
    expect(href({ name: 'match', id: 'x y' })).toBe('#/match/x%20y');
  });
});

describe('B 站嵌入参数', () => {
  it('关闭弹幕、从头播放', () => {
    const u = new URL(bilibiliEmbedUrl('BV1sffSample', 2));
    expect(u.hostname).toBe('player.bilibili.com');
    expect(u.searchParams.get('bvid')).toBe('BV1sffSample');
    expect(u.searchParams.get('page')).toBe('2');
    expect(u.searchParams.get('danmaku')).toBe('0');
    expect(u.searchParams.get('t')).toBe('0');
    expect(u.searchParams.get('autoplay')).toBe('1');
  });
});

describe('数据加载失败的说明', () => {
  it('把技术报错换成普通人看得懂的话；认不出的原样显示', () => {
    expect(describeDataError('Failed to fetch')).toMatch(/连不上数据地址/);
    expect(describeDataError('matches.json: HTTP 404')).toMatch(/还没有数据文件/);
    expect(describeDataError('matches.json: HTTP 502')).toMatch(/服务器暂时出错/);
    expect(describeDataError(`Unexpected token '<', "<!doctype" is not valid JSON`)).toMatch(
      /不是数据文件/,
    );
    expect(describeDataError('something else')).toBe('something else');
  });
});

describe('安装说明按设备排序', () => {
  it('识别 iPhone / iPad（含桌面模式的 iPad）、Android、电脑', () => {
    expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', true)).toBe(
      'ios',
    );
    expect(detectDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe('desktop');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', false)).toBe(
      'desktop',
    );
  });
});

describe('跳转平台时告诉插件/脚本的比赛信息', () => {
  it('次回合、首回合没看时带上 hideExtras，插件/脚本据此不显示加时和点球', () => {
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const match = {
      id: 'ucl-2026-27-quarter-final-real-madrid-arsenal',
      competition: 'ucl',
      season: '2026-27',
      stage: 'quarter-final',
      leg: 2,
      kickoff: '2026-10-15T19:00:00Z',
      home: { id: 'real-madrid', name: 'Real Madrid' },
      away: { id: 'arsenal', name: 'Arsenal' },
      status: 'scheduled',
      links: [],
      sources: [],
    } as const;
    notifyOpenMatch(match as never, 'https://www.miguvideo.com/x', false, true);
    notifyOpenMatch(match as never, 'https://www.miguvideo.com/x');
    const sent = spy.mock.calls.map((c) => (c[0] as { match: { hideExtras: boolean } }).match);
    expect(sent.map((m) => m.hideExtras)).toEqual([true, false]);
    spy.mockRestore();
  });
});
