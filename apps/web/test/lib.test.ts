import { describe, expect, it } from 'vitest';
import { href, parseHash } from '../src/lib/router.ts';
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
