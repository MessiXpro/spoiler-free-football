import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SITE_RULES_JSON,
  FIXTURE_LOCK_LOOKBACK_DAYS,
  getTeam,
  isKnockoutStage,
  redact,
  scorePath,
  stageLabel,
  type DataMeta,
  type PublicMatch,
  type Stage,
} from '@sff/core';
import { createApiFootballAdapter } from './adapters/api-football.ts';
import { createFootballDataAdapter } from './adapters/football-data.ts';
import { createManualAdapter, type ManualConfig } from './adapters/manual.ts';
import { createOpenfootballAdapter } from './adapters/openfootball.ts';
import { createTheSportsDbAdapter } from './adapters/thesportsdb.ts';
import type { Fetcher } from './http.ts';
import { buildLinks, type BroadcastConfig, type LinksConfig } from './links.ts';
import { cleanEnv } from './env.ts';
import { MAX_LEG_GAP_DAYS, mergeFixtures } from './merge.ts';
import { assertNoLeaks } from './privacy.ts';
import { publicProgram, scheduledEpisodes, type ProgramsConfig } from './programs.ts';
import { DAY_MS, seasonOf } from './time.ts';
import type { AdapterContext, FixtureAdapter, RawFixture } from './types.ts';

export const DATA_VERSION = 1;
export const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'config');

export interface PipelineConfig {
  broadcast: BroadcastConfig;
  programs: ProgramsConfig;
  links: LinksConfig;
  manual: ManualConfig;
}

export async function loadConfig(
  dir = CONFIG_DIR,
  overrides: Partial<Record<keyof PipelineConfig, string>> = {},
) {
  const read = async <T>(name: string, override?: string): Promise<T> =>
    JSON.parse(await readFile(override ?? join(dir, name), 'utf8')) as T;
  return {
    broadcast: await read<BroadcastConfig>('broadcast.json', overrides.broadcast),
    programs: await read<ProgramsConfig>('programs.json', overrides.programs),
    links: await read<LinksConfig>('links.json', overrides.links),
    manual: await read<ManualConfig>('manual-matches.json', overrides.manual),
  } satisfies PipelineConfig;
}

export function defaultAdapters(config: PipelineConfig): FixtureAdapter[] {
  return [
    createOpenfootballAdapter(),
    createFootballDataAdapter(),
    createTheSportsDbAdapter(),
    createApiFootballAdapter(),
    createManualAdapter(config.manual),
  ];
}

export interface BuildOptions {
  now: Date;
  fetcher: Fetcher;
  env: Record<string, string | undefined>;
  config: PipelineConfig;
  adapters?: FixtureAdapter[];
  pastDays?: number;
  futureDays?: number;
  log?: (msg: string) => void;
  /** 每个数据源的用时上限，默认 8 分钟 */
  adapterBudgetMs?: number;
  clock?: () => number;
}

export interface BuildOutput {
  meta: DataMeta;
  matches: PublicMatch[];
  /** 文件名 → 内容（相对 data 目录） */
  files: Map<string, unknown>;
  warnings: string[];
  /** 只给维护者看的诊断信息（不写进公开数据，也不含比分） */
  diagnostics: BuildDiagnostics;
}

export interface BuildDiagnostics {
  /** 目录里没有的球队名：不同来源写法不一样时会变成两场比赛，需要在 packages/core/src/catalog/teams.ts 补别名 */
  unknownTeams: Array<{ source: string; competition: string; name: string }>;
  /** 同一赛事、开球时间相近、有同一支球队的两场公开比赛：多半是同一场被拆成了两场 */
  possibleDuplicates: Array<{ competition: string; a: string; b: string }>;
  /**
   * 淘汰赛（或没写阶段的手工条目）里目录外的球队名个数。这些名字不列出：
   * 诊断会显示在 GitHub Actions 运行页上，淘汰赛对阵会暴露前一轮谁晋级
   */
  hiddenKnockoutTeams: number;
}

/** 这场比赛的对阵会不会暴露前一轮结果（没写阶段的按会处理） */
const revealsAdvancement = (stage: Stage | undefined) => !stage || isKnockoutStage(stage);

const DUPLICATE_WINDOW_MS = 3 * 60 * 60 * 1000;
const DEFAULT_ADAPTER_BUDGET_MS = 8 * 60 * 1000;

function collectDiagnostics(all: RawFixture[], matches: PublicMatch[]): BuildDiagnostics {
  const seen = new Set<string>();
  const hidden = new Set<string>();
  const unknownTeams: BuildDiagnostics['unknownTeams'] = [];
  for (const f of all) {
    for (const t of [f.home, f.away]) {
      if (getTeam(t.id)) continue;
      const key = `${f.source}|${f.competition}|${t.name}`;
      if (revealsAdvancement(f.stage)) {
        hidden.add(key);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      unknownTeams.push({ source: f.source, competition: f.competition, name: t.name });
    }
  }
  unknownTeams.sort((x, y) =>
    `${x.competition}|${x.name}|${x.source}`.localeCompare(
      `${y.competition}|${y.name}|${y.source}`,
    ),
  );
  const possibleDuplicates: BuildDiagnostics['possibleDuplicates'] = [];
  const label = (m: PublicMatch) =>
    revealsAdvancement(m.stage)
      ? `${stageLabel(m) || '淘汰赛'}（${m.kickoff}，队名已隐藏）`
      : `${m.home.name} vs ${m.away.name}（${m.kickoff}）`;
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      const a = matches[i]!;
      const b = matches[j]!;
      if (a.competition !== b.competition) continue;
      if (Math.abs(Date.parse(a.kickoff) - Date.parse(b.kickoff)) > DUPLICATE_WINDOW_MS) continue;
      // 一支球队 3 小时内不可能踢两场（主客队写反了也算）
      const teams = new Set([a.home.id, a.away.id]);
      if (!teams.has(b.home.id) && !teams.has(b.away.id)) continue;
      possibleDuplicates.push({ competition: a.competition, a: label(a), b: label(b) });
    }
  }
  return {
    unknownTeams,
    possibleDuplicates,
    hiddenKnockoutTeams: [...hidden].filter((k) => !seen.has(k)).length,
  };
}

/** 跑一遍完整管线（不写盘），方便测试 */
export async function buildData(opts: BuildOptions): Promise<BuildOutput> {
  const log = opts.log ?? (() => {});
  // GitHub Actions 里没设置的变量是空字符串，统一当作未设置
  const env = cleanEnv(opts.env);
  // 公开的已结束比赛要覆盖淘汰赛锁定往前看的天数：否则更早一轮没看完的比赛不在数据里，后一轮对阵就锁不住
  const pastDays = opts.pastDays ?? FIXTURE_LOCK_LOOKBACK_DAYS;
  // 公开的时间窗
  const windowStart = new Date(opts.now.getTime() - pastDays * DAY_MS);
  const windowEnd = new Date(opts.now.getTime() + (opts.futureDays ?? 30) * DAY_MS);
  // 拉取的时间窗更长：两回合淘汰赛的首回合可能在 4~5 周前，只用来配对首/次回合、算总比分，不公开
  const fetchStart = new Date(opts.now.getTime() - Math.max(pastDays, MAX_LEG_GAP_DAYS) * DAY_MS);
  const published = (kickoff: string) => Date.parse(kickoff) >= windowStart.getTime();
  const ctx: AdapterContext = {
    fetcher: opts.fetcher,
    now: opts.now,
    env,
    windowStart: fetchStart,
    windowEnd,
    log,
  };
  const adapters = opts.adapters ?? defaultAdapters(opts.config);
  const warnings: string[] = [];
  const sources: DataMeta['sources'] = [];
  const all: RawFixture[] = [];

  for (const adapter of adapters) {
    const reason = adapter.unavailableReason?.(env);
    if (reason) {
      sources.push({ id: adapter.id, name: adapter.name, ok: false, count: 0, note: reason });
      continue;
    }
    const clock = opts.clock ?? Date.now;
    const started = clock();
    try {
      const result = await adapter.fetch({
        ...ctx,
        clock,
        deadline: started + (opts.adapterBudgetMs ?? DEFAULT_ADAPTER_BUDGET_MS),
      });
      log(`${adapter.name}：用时 ${Math.round((clock() - started) / 1000)} 秒`);
      all.push(...result.fixtures);
      sources.push({
        id: adapter.id,
        name: adapter.name,
        ok: true,
        // 只数公开时间窗内的（多拉的历史只用来配对两回合）
        count: result.fixtures.filter((f) => published(f.kickoff)).length,
        ...(result.notes.length ? { note: result.notes.join('；') } : {}),
      });
    } catch (err) {
      sources.push({
        id: adapter.id,
        name: adapter.name,
        ok: false,
        count: 0,
        // 带「失败」：和「未设置 KEY，跳过」区分开，小结和空数据守卫都靠这个词判断
        note: `失败：${(err as Error).message}`,
      });
    }
  }

  const priority = Object.fromEntries(adapters.map((a) => [a.id, a.priority]));
  const generatedAt = opts.now.toISOString();
  const merged = mergeFixtures(all, priority, generatedAt, opts.now).filter(({ match }) =>
    published(match.kickoff),
  );
  const matches: PublicMatch[] = merged.map(({ match }) => ({
    ...match,
    links: buildLinks(match, opts.config.broadcast, opts.config.links, (w) => warnings.push(w)),
  }));

  const programs = opts.config.programs.programs.map(publicProgram);
  const episodes = scheduledEpisodes(opts.config.programs.programs, opts.now);

  // 数据源的诊断说明（报错信息等）不是我们写的文字，先遮挡再公开，避免因为偶然像比分而导致构建失败
  for (const s of sources) {
    if (s.note) s.note = redact(s.note, { football: true }).slice(0, 500);
  }

  const meta: DataMeta = {
    generatedAt,
    season: seasonOf(opts.now),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    sources,
    version: DATA_VERSION,
  };

  const broadcastPublic = {
    checkedAt: opts.config.broadcast.checkedAt,
    platforms: opts.config.broadcast.platforms,
    competitions: opts.config.broadcast.competitions,
  };

  const files = new Map<string, unknown>();
  files.set('meta.json', meta);
  files.set('matches.json', { generatedAt, matches });
  files.set('programs.json', { generatedAt, programs, episodes });
  files.set('broadcast.json', broadcastPublic);

  // 页面初始会加载的公开数据必须通过防泄露检查；不通过就整个构建失败，宁可不发布
  for (const [name, content] of files) assertNoLeaks(content, name);

  files.set('site-rules.json', DEFAULT_SITE_RULES_JSON);
  for (const { score } of merged) {
    // 文件名是比赛 id 的哈希：上传日志和网址里不会出现队名（淘汰赛的对阵本身就会剧透谁晋级）
    if (score) files.set(scorePath(score.id), score);
  }
  return { meta, matches, files, warnings, diagnostics: collectDiagnostics(all, matches) };
}

/** 写入输出目录（先清空，避免留下过期的比分文件） */
export async function writeOutput(outDir: string, output: BuildOutput): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  for (const [name, content] of output.files) {
    const path = join(outDir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(content, null, name.startsWith('scores/') ? 0 : 1)}\n`);
  }
}
