import { describe, expect, it } from 'vitest';
import { findSpoilers, type MatchLink, type PublicMatch } from '@sff/core';
import { findHint } from '../src/components/Links.tsx';

const match = {
  id: 'epl-2026-27-liverpool-arsenal',
  competition: 'epl',
  season: '2026-27',
  stage: 'regular',
  kickoff: '2026-11-01T16:30:00.000Z',
  home: { id: 'liverpool', name: '利物浦' },
  away: { id: 'arsenal', name: '阿森纳' },
  status: 'scheduled',
} as unknown as PublicMatch;

const link = (p: Partial<MatchLink>): MatchLink =>
  ({
    kind: 'replay',
    platform: 'migu',
    url: 'https://www.miguvideo.com/p/schedule/',
    label: '',
    ...p,
  }) as MatchLink;

describe('入口页：告诉用户进去后找哪一场', () => {
  it('咪咕：按北京时间的日期选，找这两队；看回放要选「全场回放」（默认放的是集锦）', () => {
    const hint = findHint(match, link({ deep: false }))!;
    // 16:30 UTC = 北京时间 11月2日 00:30
    expect(hint).toBe(
      '进去后在上方日期里选 11月2日（左右箭头翻页），找「利物浦 vs 阿森纳」；看回放时在播放器下方选「全场回放」，别选「全场集锦」',
    );
    expect(findSpoilers(hint, { football: true })).toEqual([]);
    // 集锦入口不提「全场回放」
    expect(findHint(match, link({ deep: false, kind: 'highlights' }))).toBe(
      '进去后在上方日期里选 11月2日（左右箭头翻页），找「利物浦 vs 阿森纳」',
    );
  });

  it('其他平台给通用提示；直达链接不提示', () => {
    expect(findHint(match, link({ platform: 'bilibili', deep: false }))).toBe(
      '进去后找 11月2日 的「利物浦 vs 阿森纳」',
    );
    expect(findHint(match, link({ deep: true }))).toBeNull();
  });
});
