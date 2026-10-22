// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  applyWebWatched,
  bootShield,
  currentMatchFor,
  defaultRules,
  defaultShieldSettings,
  fetchScoreFrom,
  hostDisabledBy,
  hostMatches,
  inSchedule,
  normalizeSettings,
  type ShieldSettings,
} from '../src/dom/index.ts';
import { CLASS_READY } from '../src/dom/css.ts';
import { NOT_SCORE_DATA } from '../src/index.ts';

const BASE = 'https://example.github.io/app/data/';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 全网模式全天开启（jsdom 页面域名是 localhost，没有站点规则） */
function alwaysOn(): ShieldSettings {
  const s = defaultShieldSettings(BASE);
  s.global = { enabled: true, start: '00:00', end: '00:00', days: [0, 1, 2, 3, 4, 5, 6] };
  return s;
}

describe('插件/脚本启动逻辑', () => {
  it('全网模式时段（含跨午夜）', () => {
    const g = { enabled: true, start: '06:00', end: '12:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(inSchedule(g, new Date(2026, 9, 17, 8, 0))).toBe(true);
    expect(inSchedule(g, new Date(2026, 9, 17, 13, 0))).toBe(false);
    const night = { ...g, start: '22:00', end: '08:00' };
    expect(inSchedule(night, new Date(2026, 9, 17, 23, 0))).toBe(true);
    expect(inSchedule(night, new Date(2026, 9, 18, 7, 59))).toBe(true);
    expect(inSchedule(night, new Date(2026, 9, 18, 9, 0))).toBe(false);
    expect(inSchedule({ ...g, enabled: false }, new Date(2026, 9, 17, 8, 0))).toBe(false);
    expect(inSchedule({ ...g, days: [1] }, new Date(2026, 9, 17, 8, 0))).toBe(false); // 周六
  });

  it('域名匹配', () => {
    expect(hostMatches('www.miguvideo.com', 'miguvideo.com')).toBe(true);
    expect(hostMatches('www.miguvideo.com', 'm.miguvideo.com')).toBe(true);
    expect(hostMatches('www.bilibili.com', 'miguvideo.com')).toBe(false);
  });

  it('正在看的比赛：同平台、6 小时内有效', () => {
    const s = defaultShieldSettings(BASE);
    s.currentMatch = {
      id: 'x',
      title: 't',
      competition: 'epl',
      kickoff: '',
      home: { id: 'a', name: 'A' },
      away: { id: 'b', name: 'B' },
      url: 'https://www.miguvideo.com/p/x',
      host: 'www.miguvideo.com',
      at: Date.now(),
    };
    expect(currentMatchFor(s, 'www.miguvideo.com')?.id).toBe('x');
    expect(currentMatchFor(s, 'www.bilibili.com')).toBeNull();
    expect(currentMatchFor(s, 'www.miguvideo.com', Date.now() + 7 * 3600_000)).toBeNull();
  });

  it('设置清洗：非法的远程规则和数据地址被丢弃', () => {
    const s = normalizeSettings(
      { enabled: false, rules: { schema: 9 } as never, dataBase: 'javascript:alert(1)' },
      BASE,
    );
    expect(s.enabled).toBe(false);
    expect(s.rules).toBeUndefined();
    expect(s.dataBase).toBe(BASE);
    expect(s.prefs.hide.comments).toBe(true);
  });

  it('关闭时立即显示页面、不做任何修改', () => {
    document.documentElement.className = '';
    document.body.innerHTML = '<p>阿森纳 2-1 切尔西</p>';
    const c = bootShield(
      document,
      { ...defaultShieldSettings(BASE), enabled: false },
      { siteMode: true },
    );
    expect(c.active).toBe(false);
    expect(document.documentElement.classList.contains(CLASS_READY)).toBe(true);
    expect(document.body.textContent).toContain('2-1');
  });

  it('全网模式不在时段内时不工作；在时段内只做通用识别', () => {
    document.documentElement.className = '';
    document.body.innerHTML = '<p>Arsenal 2-1 Chelsea</p>';
    const off = bootShield(document, defaultShieldSettings(BASE), { siteMode: false });
    expect(off.active).toBe(false);
    const settings = defaultShieldSettings(BASE);
    settings.global = { enabled: true, start: '00:00', end: '00:00', days: [0, 1, 2, 3, 4, 5, 6] };
    const on = bootShield(document, settings, { siteMode: false });
    expect(on.active).toBe(true);
    expect(on.site).toBeNull();
    expect(document.body.textContent).toBe('Arsenal ■-■ Chelsea');
    on.pause(10);
    expect(document.body.textContent).toBe('Arsenal 2-1 Chelsea');
    on.resume();
    expect(document.body.textContent).toBe('Arsenal ■-■ Chelsea');
    on.shield?.stop();
  });

  it('停用名单只覆盖该域名及其子域名：在子域名停用不会连带停用主站', () => {
    document.documentElement.className = '';
    document.body.innerHTML = '<p>曼联 2-1 利物浦</p>';
    const c = bootShield(
      document,
      { ...alwaysOn(), disabledHosts: ['live.localhost'] },
      { siteMode: false },
    );
    expect(c.active).toBe(true);
    expect(document.body.textContent).toBe('曼联 ■-■ 利物浦');
    // 设置更新时同样只按单向匹配
    c.update({ ...alwaysOn(), disabledHosts: ['m.localhost'] });
    expect(c.shield?.stats.paused).toBe(false);
    c.update({ ...alwaysOn(), disabledHosts: ['localhost'] });
    expect(c.shield?.stats.paused).toBe(true);
    c.shield?.stop();
    const off = bootShield(
      document,
      { ...alwaysOn(), disabledHosts: ['localhost'] },
      {
        siteMode: false,
      },
    );
    expect(off.active).toBe(false);

    expect(hostDisabledBy('www.bilibili.com', 'live.bilibili.com')).toBe(false);
    expect(hostDisabledBy('bilibili.com', 'search.bilibili.com')).toBe(false);
    expect(hostDisabledBy('sports.qq.com', 'kbs.sports.qq.com')).toBe(false);
    expect(hostDisabledBy('www.miguvideo.com', 'm.miguvideo.com')).toBe(false);
    expect(hostDisabledBy('www.bilibili.com', 'bilibili.com')).toBe(true);
    expect(hostDisabledBy('bilibili.com', 'www.bilibili.com')).toBe(true);
    expect(hostDisabledBy('live.bilibili.com', 'bilibili.com')).toBe(true);
    expect(hostDisabledBy('live.bilibili.com', 'live.bilibili.com')).toBe(true);
    // "正在看的比赛"仍按同平台双向匹配
    expect(hostMatches('www.miguvideo.com', 'm.miguvideo.com')).toBe(true);
  });

  it('临时显示期间停用：旧计时器到期后不会重新打开遮挡', async () => {
    document.documentElement.className = '';
    document.body.innerHTML = '<p>阿森纳 2-1 切尔西</p>';
    const settings = alwaysOn();
    const c = bootShield(document, settings, { siteMode: false });
    expect(document.body.textContent).toBe('阿森纳 ■-■ 切尔西');
    c.pause(30);
    expect(document.body.textContent).toBe('阿森纳 2-1 切尔西');
    c.update({ ...settings, enabled: false });
    await wait(80);
    expect(document.body.textContent).toBe('阿森纳 2-1 切尔西');
    expect(c.shield?.stats.paused).toBe(true);
    // 停用期间点"恢复遮挡"也不打开
    c.resume();
    expect(c.shield?.stats.paused).toBe(true);
    // 重新启用后恢复遮挡
    c.update(settings);
    expect(document.body.textContent).toBe('阿森纳 ■-■ 切尔西');
    c.shield?.stop();
  });

  it('无关的设置写入不会提前结束临时显示', async () => {
    document.documentElement.className = '';
    document.body.innerHTML = '<p>曼联 2-1 利物浦</p>';
    const settings = alwaysOn();
    const c = bootShield(document, settings, { siteMode: false });
    c.pause(5 * 60 * 1000);
    c.update(normalizeSettings({ ...settings, rulesCheckedAt: Date.now() }, BASE));
    c.update({ ...settings, watched: { x: 1 } });
    expect(document.body.textContent).toBe('曼联 2-1 利物浦');
    expect(c.shield?.stats.paused).toBe(true);
    c.resume();
    expect(document.body.textContent).toBe('曼联 ■-■ 利物浦');
    // 计时器到期后照常恢复
    c.pause(20);
    c.update({ ...settings, watched: { y: 1 } });
    expect(c.shield?.stats.paused).toBe(true);
    await wait(60);
    expect(document.body.textContent).toBe('曼联 ■-■ 利物浦');
    c.shield?.stop();
  });

  it('存下的远程规则比内置规则旧时改用内置规则', () => {
    const bundled = defaultRules();
    const old = normalizeSettings(
      { rules: { ...bundled, version: '2000-01-01', sites: [] } },
      BASE,
    );
    expect(old.rules).toBeUndefined();
    const same = normalizeSettings({ rules: bundled }, BASE);
    expect(same.rules?.version).toBe(bundled.version);
    const newer = normalizeSettings({ rules: { ...bundled, version: '2999-01-01' } }, BASE);
    expect(newer.rules?.version).toBe('2999-01-01');
  });

  it('不工作时页面改写 <html class> 也不会重新变空白', async () => {
    document.documentElement.className = '';
    const c = bootShield(
      document,
      { ...defaultShieldSettings(BASE), enabled: false },
      { siteMode: true },
    );
    expect(c.active).toBe(false);
    document.documentElement.className = 'theme-dark';
    await wait(0);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains(CLASS_READY)).toBe(true);
  });
});

describe('applyWebWatched：网页发来的已看记录', () => {
  it('unwatch 删掉这些 id', () => {
    expect(applyWebWatched({ a: 10, b: 20 }, { type: 'unwatch', ids: ['a', 'x', 3] })).toEqual({
      watched: { b: 20 },
      changed: true,
    });
    expect(applyWebWatched({ b: 20 }, { type: 'unwatch', ids: ['a'] }).changed).toBe(false);
  });

  it('hello 丢掉网页删除之前的旧记录，删除之后重新看过的保留', () => {
    const r = applyWebWatched(
      { old: 100, again: 300, other: 50 },
      { type: 'hello', watched: { fresh: 400, old: 90 }, unwatched: { old: 200, again: 200 } },
    );
    expect(r).toEqual({ watched: { again: 300, other: 50, fresh: 400 }, changed: true });
  });

  it('state 只加不减，也不看 unwatched', () => {
    expect(
      applyWebWatched({ a: 1 }, { type: 'state', watched: { b: 2, c: 'x' }, unwatched: { a: 5 } }),
    ).toEqual({ watched: { a: 1, b: 2 }, changed: true });
    expect(applyWebWatched({ a: 1 }, { type: 'state', watched: { a: 9 } }).changed).toBe(false);
  });
});

describe('控制器跟着设置和时段走', () => {
  const week = [0, 1, 2, 3, 4, 5, 6];

  it('全网模式：页面一直开着，跨过时段开始/结束时自动启动、自动解除', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 17, 5, 59));
      document.documentElement.className = '';
      document.body.innerHTML = '<p>Arsenal 2-1 Chelsea</p>';
      const s = defaultShieldSettings(BASE);
      s.global = { enabled: true, start: '06:00', end: '12:00', days: week };
      const c = bootShield(document, s, { siteMode: false });
      expect(c.active).toBe(false);
      expect(c.reason).toBe('不在全网防剧透时段');
      expect(document.body.textContent).toBe('Arsenal 2-1 Chelsea');

      vi.setSystemTime(new Date(2026, 9, 17, 6, 0));
      vi.advanceTimersByTime(60_000);
      expect(c.active).toBe(true);
      expect(document.body.textContent).toBe('Arsenal ■-■ Chelsea');

      // 时段结束：不再算工作中，但已经遮住的内容不会突然露出来（保持到刷新）
      vi.setSystemTime(new Date(2026, 9, 17, 12, 0));
      vi.advanceTimersByTime(60_000);
      expect(c.active).toBe(false);
      expect(c.reason).toBe('不在全网防剧透时段');
      expect(document.body.textContent).toBe('Arsenal ■-■ Chelsea');

      vi.setSystemTime(new Date(2026, 9, 18, 6, 0));
      vi.advanceTimersByTime(60_000);
      expect(c.active).toBe(true);
      expect(document.body.textContent).toBe('Arsenal ■-■ Chelsea');
      c.shield?.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('设置从关闭改为开启、从停用改为启用时，不用重新启动就开始遮挡', () => {
    document.documentElement.className = '';
    document.body.innerHTML = '<p>曼联 2-1 利物浦</p>';
    const c = bootShield(document, { ...alwaysOn(), enabled: false }, { siteMode: false });
    expect(c.active).toBe(false);
    c.update(alwaysOn());
    expect(c.active).toBe(true);
    expect(document.body.textContent).toBe('曼联 ■-■ 利物浦');
    c.update({ ...alwaysOn(), disabledHosts: ['localhost'] });
    expect(document.body.textContent).toBe('曼联 2-1 利物浦');
    // 状态也要跟着变（弹窗/面板据此显示），不能显示成「已临时显示」
    expect(c.active).toBe(false);
    expect(c.reason).toBe('此站点已停用');
    c.update({ ...alwaysOn(), enabled: false });
    expect(c.reason).toBe('已关闭');
    c.update(alwaysOn());
    expect(c.active).toBe(true);
    expect(document.body.textContent).toBe('曼联 ■-■ 利物浦');
    c.shield?.stop();
  });

  it('下载比分：404 是还没有比分；200 却不是 JSON 要报错，不能当成「没有比分」', async () => {
    const reply = (body: string, status = 200) =>
      (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await fetchScoreFrom(BASE, 'm1', reply('', 404))).toBeNull();
    expect(
      await fetchScoreFrom(BASE, 'm1', reply(JSON.stringify({ id: 'm1', home: 2, away: 1 }))),
    ).toMatchObject({ home: 2, away: 1 });
    expect(
      await fetchScoreFrom(BASE, 'm1', reply(JSON.stringify({ id: 'other', home: 2, away: 1 }))),
    ).toBeNull();
    await expect(
      fetchScoreFrom(BASE, 'm1', reply('<!doctype html><title>请先登录</title>')),
    ).rejects.toThrow(NOT_SCORE_DATA);
    await expect(fetchScoreFrom(BASE, 'm1', reply('x', 500))).rejects.toThrow('HTTP 500');
  });
});
