import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  competitionName,
  findSpoilers,
  matchesInWindow,
  defaultUserState,
  nightWindow,
  scorePath,
  type PublicMatch,
} from '@sff/core';
import { buildData, CONFIG_DIR, loadConfig, stampRulesVersion, writeOutput } from '../src/build.ts';
import { mergeFixtures } from '../src/merge.ts';
import { findPublicDataLeaks, assertNoLeaks } from '../src/privacy.ts';
import { buildLinks, isOfficialUrl } from '../src/links.ts';
import { scheduledEpisodes } from '../src/programs.ts';
import { SAMPLE_DIR, SAMPLE_ENV, SAMPLE_NOW, sampleFetcher } from '../src/sample.ts';
import { stepSummary } from '../src/summary.ts';
import type { RawFixture } from '../src/types.ts';

async function sampleBuild() {
  const config = await loadConfig(CONFIG_DIR, { links: join(SAMPLE_DIR, 'links.sample.json') });
  return buildData({ now: SAMPLE_NOW, fetcher: sampleFetcher(), env: SAMPLE_ENV, config });
}

describe('完整管线（示例数据）', () => {
  it('昨夜今晨包含订阅球队的比赛，按开球时间排序', async () => {
    const out = await sampleBuild();
    const night = matchesInWindow(out.matches, defaultUserState(), nightWindow(SAMPLE_NOW));
    expect(night.map((m) => m.id)).toEqual([
      'epl-2026-27-bournemouth-liverpool',
      'epl-2026-27-man-city-sunderland',
      'laliga-2026-27-atletico-real-madrid',
      'epl-2026-27-fulham-man-utd',
    ]);
  });

  it('公开数据里没有任何比分、结果词和比分字段', async () => {
    const out = await sampleBuild();
    for (const name of ['matches.json', 'programs.json', 'meta.json', 'broadcast.json']) {
      const content = out.files.get(name);
      expect(findPublicDataLeaks(content, name)).toEqual([]);
      const text = JSON.stringify(content);
      expect(text).not.toMatch(/"(score|goals|winner|fullTime|halfTime|penalties|duration)"/i);
    }
    // 球队名、标签逐条检查
    for (const m of out.matches) {
      for (const l of m.links) expect(findSpoilers(l.label, { football: true })).toEqual([]);
    }
  });

  it('比分只在 scores/<id 的哈希>.json，且 id 与比赛对应', async () => {
    const out = await sampleBuild();
    const ids = new Set(out.matches.map((m) => m.id));
    const scoreFiles = [...out.files.keys()].filter((k) => k.startsWith('scores/'));
    expect(scoreFiles.length).toBeGreaterThan(50);
    for (const f of scoreFiles) {
      const rec = out.files.get(f) as { id: string; home: number; away: number };
      expect(ids.has(rec.id)).toBe(true);
      expect(f).toBe(scorePath(rec.id));
      // 文件名里没有队名：上传日志会列出所有文件名，淘汰赛对阵本身就是剧透
      expect(f).toMatch(/^scores\/[0-9a-f]{24}\.json$/);
      expect(typeof rec.home).toBe('number');
    }
    // 未来比赛不会有比分文件
    const future = out.matches.filter(
      (m) => Date.parse(m.kickoff) > SAMPLE_NOW.getTime() + 86400000,
    );
    for (const m of future.filter((x) => x.competition === 'epl')) {
      expect(out.files.has(scorePath(m.id))).toBe(false);
    }
  });

  it('多来源合并：同一场比赛只出现一次，来源合并', async () => {
    const out = await sampleBuild();
    const evt = out.matches.filter((m) => m.home.id === 'everton' && m.away.id === 'chelsea');
    expect(evt).toHaveLength(1);
    expect(evt[0]!.sources.sort()).toEqual(['football-data', 'openfootball']);
    const ids = out.matches.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('链接只指向正版/官方平台；示例集锦可内嵌', async () => {
    const out = await sampleBuild();
    for (const m of out.matches)
      for (const l of m.links) expect(isOfficialUrl(l.url), l.url).toBe(true);
    const city = out.matches.find((m) => m.id === 'epl-2026-27-man-city-sunderland')!;
    expect(city.links[0]!.embed?.bvid).toBe('BV1sffSample');
    expect(city.links.some((l) => l.platform === 'migu')).toBe(true);
  });

  it('写盘：清空旧文件后写入', async () => {
    const out = await sampleBuild();
    const dir = await mkdtemp(join(tmpdir(), 'sff-'));
    await writeOutput(dir, out);
    const files = await readdir(dir);
    expect(files.sort()).toEqual([
      'broadcast.json',
      'matches.json',
      'meta.json',
      'programs.json',
      'scores',
      'site-rules.json',
    ]);
    const matches = JSON.parse(await readFile(join(dir, 'matches.json'), 'utf8')) as {
      matches: PublicMatch[];
    };
    expect(matches.matches.length).toBe(out.matches.length);
  });

  it('数据源的报错说明即使碰巧像比分，也会先遮挡，不导致构建失败', async () => {
    const config = await loadConfig(CONFIG_DIR, { links: join(SAMPLE_DIR, 'links.sample.json') });
    const out = await buildData({
      now: SAMPLE_NOW,
      fetcher: sampleFetcher(),
      env: SAMPLE_ENV,
      config,
      adapters: [
        {
          id: 'weird',
          name: '奇怪的数据源',
          priority: 1,
          fetch: async () => ({ fixtures: [], notes: ['上游返回：Arsenal 2-1 Chelsea 绝杀'] }),
        },
      ],
    });
    const note = out.meta.sources[0]!.note!;
    expect(note.startsWith('上游返回：Arsenal ■-■')).toBe(true);
    expect(findSpoilers(note, { football: true })).toEqual([]);
  });

  it('meta 记录每个来源的情况（缺 Key 的标为跳过）', async () => {
    const out = await sampleBuild();
    const byId = Object.fromEntries(out.meta.sources.map((s) => [s.id, s]));
    expect(byId.openfootball!.ok).toBe(true);
    expect(byId['api-football']!.ok).toBe(false);
    expect(byId['api-football']!.note).toMatch(/APIFOOTBALL_KEY/);
  });

  it('运行页小结按赛事列出场数：每项赛事一行，按场数从多到少，只有赛事名和数字', async () => {
    const out = await sampleBuild();
    const summary = stepSummary(out, 0);
    expect(summary).toContain('### 各赛事场数');
    const section = summary.split('\n### ').find((s) => s.startsWith('各赛事场数'))!;
    expect(section).toContain('| 赛事 | 场数 |');
    const competitions = [...new Set(out.matches.map((m) => m.competition))];
    expect(competitions.length).toBeGreaterThan(1);
    for (const id of competitions) {
      const n = out.matches.filter((m) => m.competition === id).length;
      expect(section).toContain(`| ${competitionName(id)} | ${n} |`);
    }
    const counts = [...section.matchAll(/^\| .+ \| (\d+) \|$/gm)].map((m) => Number(m[1]));
    expect(counts).toHaveLength(competitions.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    // 没有队名，也没有结果词
    for (const m of out.matches)
      for (const t of [m.home, m.away]) expect(section).not.toContain(t.name);
    expect(findSpoilers(section)).toEqual([]);
    expect(findSpoilers(section, { football: true })).toEqual([]);
  });
});

describe('防泄露检查本身', () => {
  it('链接的查询串、#片段、域名里的比分也拦下；平台的跟踪参数不误伤', () => {
    expect(
      findPublicDataLeaks({ url: 'https://v.example.com/watch?title=arsenal-2-1-chelsea' }),
    ).toHaveLength(1);
    expect(findPublicDataLeaks({ url: 'https://v.example.com/watch#2-1' })).toHaveLength(1);
    expect(findPublicDataLeaks({ url: 'https://2-1.example.com/watch' })).toHaveLength(1);
    expect(findPublicDataLeaks({ url: 'https://v.example.com/live?score=3:1' })).toHaveLength(1);
    expect(
      findPublicDataLeaks({
        url: 'https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.999.0.0&vd_source=abc123&p=2&t=90',
      }),
    ).toEqual([]);
    // 地址栏复制的 B 站链接：跟踪参数里的 2-3-6 不是比分
    expect(
      findPublicDataLeaks({
        url: 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1007.tianma.2-3-6.click&vd_source=a1',
      }),
    ).toEqual([]);
    expect(findPublicDataLeaks({ url: 'https://x.example/a?ref=1-2-3' })).toEqual([]);
    expect(
      findPublicDataLeaks({ url: 'https://www.miguvideo.com/p/live/120000?from=2026-10-16' }),
    ).toEqual([]);
  });

  it('能抓到比分、结果词、比分字段名、带比分的链接', () => {
    expect(findPublicDataLeaks({ title: '阿森纳 2-1 切尔西' })).toHaveLength(1);
    expect(findPublicDataLeaks({ note: '曼城逆转' })).toHaveLength(1);
    expect(findPublicDataLeaks({ score: 1 })).toHaveLength(1);
    expect(findPublicDataLeaks({ m: { fullTime: null } })).toHaveLength(1);
    expect(
      findPublicDataLeaks({ url: 'https://example.com/news/arsenal-2-1-chelsea' }),
    ).toHaveLength(1);
    expect(findPublicDataLeaks({ url: 'https://example.com/2026-10-17/arsenal-chelsea' })).toEqual(
      [],
    );
    expect(findPublicDataLeaks({ home: { name: 'Melbourne Victory' } })).toEqual([]);
    expect(() => assertNoLeaks({ a: '皇马晋级' })).toThrow(/泄露/);
  });
});

describe('合并与两回合', () => {
  const f = (p: Partial<RawFixture>): RawFixture => ({
    source: 'a',
    sourceId: Math.random().toString(),
    competition: 'ucl',
    season: '2026-27',
    stage: 'round-of-16',
    kickoff: '2027-03-10T20:00:00.000Z',
    home: { id: 'arsenal', name: '阿森纳' },
    away: { id: 'psv', name: 'PSV埃因霍温' },
    status: 'scheduled',
    finished: false,
    ...p,
  });

  it('首回合/次回合与总比分', () => {
    const merged = mergeFixtures(
      [
        f({ finished: true, score: { home: 2, away: 0 } }),
        f({
          kickoff: '2027-03-17T20:00:00.000Z',
          home: { id: 'psv', name: '' },
          away: { id: 'arsenal', name: '' },
          finished: true,
          score: { home: 1, away: 1 },
        }),
      ],
      { a: 1 },
      'now',
    );
    expect(merged.map((m) => m.match.leg)).toEqual([1, 2]);
    expect(merged[1]!.score?.aggregate).toEqual([1, 3]);
  });

  it('不同来源、开球时间略有差异时合并；高优先级来源的时间为准', () => {
    const merged = mergeFixtures(
      [
        f({ source: 'low', kickoff: '2027-03-10T19:00:00.000Z' }),
        f({ source: 'high', kickoff: '2027-03-10T20:00:00.000Z' }),
      ],
      { low: 1, high: 9 },
      'now',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.match.kickoff).toBe('2027-03-10T20:00:00.000Z');
    expect(merged[0]!.match.sources.sort()).toEqual(['high', 'low']);
  });

  it('目录外球队写法不同也能合并', () => {
    const merged = mergeFixtures(
      [
        f({
          source: 'high',
          competition: 'fa-cup',
          stage: 'round-3',
          away: { id: 'x-wycombe-wanderers', name: 'Wycombe Wanderers' },
        }),
        f({
          source: 'low',
          competition: 'fa-cup',
          stage: 'round-3',
          away: { id: 'x-wycombe', name: 'Wycombe' },
        }),
      ],
      { low: 1, high: 9 },
      'now',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.match.away.name).toBe('Wycombe Wanderers');
  });
});

describe('链接与节目', () => {
  it('非官方链接被拒绝', async () => {
    const config = await loadConfig();
    const warnings: string[] = [];
    const links = buildLinks(
      {
        id: 'x',
        competition: 'epl',
        season: '2026-27',
        stage: 'regular',
        kickoff: '2026-10-17T11:30:00Z',
        home: { id: 'man-city', name: '' },
        away: { id: 'arsenal', name: '' },
        status: 'scheduled',
        sources: [],
      },
      config.broadcast,
      {
        links: {
          x: [
            { kind: 'replay', platform: 'migu', url: 'https://pirate.example.com/x' },
            { kind: 'highlights', platform: 'bilibili', bvid: 'bad' },
          ],
        },
      },
      (w) => warnings.push(w),
    );
    expect(warnings).toHaveLength(2);
    expect(links.every((l) => isOfficialUrl(l.url))).toBe(true);
    expect(links.some((l) => l.label.includes('曼城官方号'))).toBe(true);
  });

  it('天下足球：按周一 19:30 生成最近两期和下一期，标题只有日期', async () => {
    const config = await loadConfig();
    const eps = scheduledEpisodes(config.programs.programs, new Date('2026-10-16T12:00:00Z'));
    const txzq = eps.filter((e) => e.programId === 'txzq');
    expect(txzq.map((e) => e.airTime)).toEqual([
      '2026-10-05T11:30:00.000Z',
      '2026-10-12T11:30:00.000Z',
      '2026-10-19T11:30:00.000Z',
    ]);
    expect(txzq[1]!.label).toBe('天下足球 · 10月12日（周一）');
    // 国内无正版的节目不生成条目
    expect(eps.some((e) => e.programId === 'motd')).toBe(false);
  });

  it('节目配置：国内无正版的节目不提供观看链接', async () => {
    const config = await loadConfig();
    for (const p of config.programs.programs) {
      if (p.availability === 'unavailable-in-china') expect(p.platforms).toEqual([]);
      else expect(p.platforms.length).toBeGreaterThan(0);
    }
    const ids = config.programs.programs.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['txzq', 'gjoz', 'motd', 'mnf', 'pl-official', 'overlap']),
    );
  });
});

describe('站点规则的版本号自动盖上提交时间', () => {
  const rules = { version: '2026-10-16', sites: [] };
  it('提交时间比文件里的 version 新就用提交时间；旧的、没有的、格式不对的都用文件里的', () => {
    expect(stampRulesVersion(rules, '2026-10-22T10:36:00+00:00').version).toBe('2026-10-22T10:36');
    expect(stampRulesVersion(rules, '2026-10-16T09:00:00Z').version).toBe('2026-10-16T09:00');
    expect(stampRulesVersion(rules, '2026-10-01T09:00:00Z').version).toBe('2026-10-16');
    expect(
      stampRulesVersion({ ...rules, version: '2026-10-23.2' }, '2026-10-22T10:36:00Z').version,
    ).toBe('2026-10-23.2');
    expect(stampRulesVersion(rules, undefined).version).toBe('2026-10-16');
    expect(stampRulesVersion(rules, 'not a date').version).toBe('2026-10-16');
    expect(stampRulesVersion(rules, '').version).toBe('2026-10-16');
  });

  it('管线输出的 site-rules.json 带盖过的版本号，其他内容不变', async () => {
    const config = await loadConfig(CONFIG_DIR, { links: join(SAMPLE_DIR, 'links.sample.json') });
    const out = await buildData({
      now: SAMPLE_NOW,
      fetcher: sampleFetcher(),
      env: { ...SAMPLE_ENV, SFF_RULES_STAMP: '2099-01-02T03:04:05Z' },
      config,
    });
    const doc = out.files.get('site-rules.json') as { version: string; sites: unknown[] };
    expect(doc.version).toBe('2099-01-02T03:04');
    expect(doc.sites.length).toBeGreaterThan(0);
  });
});
