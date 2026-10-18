import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_RULES_JSON,
  isNewerRules,
  isSafeSelector,
  matchSite,
  validateSiteRules,
} from '../src/index.ts';

describe('站点规则', () => {
  const rules = validateSiteRules(DEFAULT_SITE_RULES_JSON);

  it('内置规则通过校验，且覆盖要求的站点', () => {
    expect(rules).not.toBeNull();
    const ids = rules!.sites.map((s) => s.id);
    for (const id of [
      'bilibili',
      'miguvideo',
      'yangshipin',
      'cctv',
      'iqiyi',
      'tencent',
      'dongqiudi',
      'zhibo8',
      'hupu',
    ]) {
      expect(ids).toContain(id);
    }
    // 校验不应丢掉内置规则里的任何选择器
    const raw = DEFAULT_SITE_RULES_JSON as { sites: Array<{ hide: Record<string, string[]> }> };
    raw.sites.forEach((site, i) => {
      for (const [cat, list] of Object.entries(site.hide)) {
        expect(rules!.sites[i]!.hide?.[cat as 'duration']).toEqual(list);
      }
    });
  });

  it('按域名后缀匹配', () => {
    expect(matchSite(rules!, 'www.bilibili.com')?.id).toBe('bilibili');
    expect(matchSite(rules!, 'm.bilibili.com')?.id).toBe('bilibili');
    expect(matchSite(rules!, 'tv.cctv.com')?.id).toBe('cctv');
    expect(matchSite(rules!, 'kbs.sports.qq.com')?.id).toBe('tencent');
    expect(matchSite(rules!, 'notbilibili.com')).toBeNull();
    expect(matchSite(rules!, 'example.com')).toBeNull();
  });

  it('拒绝可注入 CSS 或加载外部资源的选择器', () => {
    expect(isSafeSelector('.a .b')).toBe(true);
    expect(isSafeSelector("[class*='score' i]")).toBe(true);
    expect(isSafeSelector('.a{display:block}')).toBe(false);
    expect(isSafeSelector('.a;}body{display:none')).toBe(false);
    expect(isSafeSelector('@import url(x)')).toBe(false);
    expect(isSafeSelector('div[style*=url(http://x)]')).toBe(false);
    expect(isSafeSelector('')).toBe(false);
    expect(isSafeSelector(42)).toBe(false);
  });

  it('不合格的远程规则被拒绝或清洗', () => {
    expect(validateSiteRules(null)).toBeNull();
    expect(validateSiteRules({ schema: 2, version: 'x', sites: [] })).toBeNull();
    expect(validateSiteRules({ schema: 1, version: 'x', sites: 'nope' })).toBeNull();
    const cleaned = validateSiteRules({
      schema: 1,
      version: '2026-11-01',
      sites: [
        { id: 'ok', hosts: ['example.com'], hide: { comments: ['.c', '.x{}'] }, code: 'alert(1)' },
        { id: 'BAD ID', hosts: ['x.com'] },
        { id: 'nohost', hosts: ['not a host'] },
      ],
      extraWords: ['新词', 5, ''],
    })!;
    expect(cleaned.sites).toHaveLength(1);
    expect(cleaned.sites[0]!.hide?.comments).toEqual(['.c']);
    expect('code' in cleaned.sites[0]!).toBe(false);
    expect(cleaned.extraWords).toEqual(['新词']);
  });

  it('版本比较', () => {
    expect(isNewerRules('2026-11-01', '2026-10-16')).toBe(true);
    expect(isNewerRules('2026-10-16.2', '2026-10-16')).toBe(true);
    expect(isNewerRules('2026-10-01', '2026-10-16')).toBe(false);
  });
});
