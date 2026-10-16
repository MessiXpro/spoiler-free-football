// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  bootShield,
  currentMatchFor,
  defaultShieldSettings,
  hostMatches,
  inSchedule,
  normalizeSettings,
} from '../src/dom/index.ts';
import { CLASS_READY } from '../src/dom/css.ts';

const BASE = 'https://example.github.io/app/data/';

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
});
