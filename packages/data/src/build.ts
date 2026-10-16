import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SITE_RULES_JSON, type DataMeta, type PublicMatch } from '@sff/core';
import { createApiFootballAdapter } from './adapters/api-football.ts';
import { createFootballDataAdapter } from './adapters/football-data.ts';
import { createManualAdapter, type ManualConfig } from './adapters/manual.ts';
import { createOpenfootballAdapter } from './adapters/openfootball.ts';
import { createTheSportsDbAdapter } from './adapters/thesportsdb.ts';
import type { Fetcher } from './http.ts';
import { buildLinks, type BroadcastConfig, type LinksConfig } from './links.ts';
import { mergeFixtures } from './merge.ts';
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
}

export interface BuildOutput {
  meta: DataMeta;
  matches: PublicMatch[];
  /** 文件名 → 内容（相对 data 目录） */
  files: Map<string, unknown>;
  warnings: string[];
}

/** 跑一遍完整管线（不写盘），方便测试 */
export async function buildData(opts: BuildOptions): Promise<BuildOutput> {
  const log = opts.log ?? (() => {});
  const windowStart = new Date(opts.now.getTime() - (opts.pastDays ?? 21) * DAY_MS);
  const windowEnd = new Date(opts.now.getTime() + (opts.futureDays ?? 30) * DAY_MS);
  const ctx: AdapterContext = {
    fetcher: opts.fetcher,
    now: opts.now,
    env: opts.env,
    windowStart,
    windowEnd,
    log,
  };
  const adapters = opts.adapters ?? defaultAdapters(opts.config);
  const warnings: string[] = [];
  const sources: DataMeta['sources'] = [];
  const all: RawFixture[] = [];

  for (const adapter of adapters) {
    const reason = adapter.unavailableReason?.(opts.env);
    if (reason) {
      sources.push({ id: adapter.id, name: adapter.name, ok: false, count: 0, note: reason });
      continue;
    }
    try {
      const result = await adapter.fetch(ctx);
      all.push(...result.fixtures);
      sources.push({
        id: adapter.id,
        name: adapter.name,
        ok: true,
        count: result.fixtures.length,
        ...(result.notes.length ? { note: result.notes.join('；') } : {}),
      });
    } catch (err) {
      sources.push({
        id: adapter.id,
        name: adapter.name,
        ok: false,
        count: 0,
        note: (err as Error).message,
      });
    }
  }

  const priority = Object.fromEntries(adapters.map((a) => [a.id, a.priority]));
  const generatedAt = opts.now.toISOString();
  const merged = mergeFixtures(all, priority, generatedAt);
  const matches: PublicMatch[] = merged.map(({ match }) => ({
    ...match,
    links: buildLinks(match, opts.config.broadcast, opts.config.links, (w) => warnings.push(w)),
  }));

  const programs = opts.config.programs.programs.map(publicProgram);
  const episodes = scheduledEpisodes(opts.config.programs.programs, opts.now);

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
    if (score) files.set(`scores/${score.id}.json`, score);
  }
  return { meta, matches, files, warnings };
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
