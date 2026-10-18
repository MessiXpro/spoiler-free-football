import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildData, CONFIG_DIR, loadConfig, writeOutput } from './build.ts';
import { envValue } from './env.ts';
import { createHttpFetcher } from './http.ts';
import { SAMPLE_DIR, SAMPLE_ENV, SAMPLE_NOW, sampleFetcher } from './sample.ts';
import { sourceStatus, stepSummary } from './summary.ts';

/**
 * 用法：
 *   tsx src/cli.ts --out ../../apps/web/public/data           真实数据（读环境变量里的 API Key）
 *   tsx src/cli.ts --sample --out ../../apps/web/public/data  示例数据（离线、固定时间）
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sample = process.argv.includes('--sample');
  const outDir = resolve(arg('out') ?? 'dist/data');
  const log = (msg: string) => console.log(msg);
  const now = sample ? SAMPLE_NOW : new Date(arg('now') ?? Date.now());
  const config = await loadConfig(
    CONFIG_DIR,
    sample ? { links: join(SAMPLE_DIR, 'links.sample.json') } : {},
  );
  const fetcher = sample
    ? sampleFetcher()
    : createHttpFetcher({
        // 空字符串当作未设置（否则 resolve('') 会把缓存写进当前目录）
        cacheDir: resolve(envValue(process.env, 'SFF_HTTP_CACHE') ?? '.http-cache'),
        log,
        defaultIntervalMs: 1000,
        minIntervalMs: {
          'api.football-data.org': 6500,
          'www.thesportsdb.com': 2200,
          'v3.football.api-sports.io': 6500,
          'raw.githubusercontent.com': 300,
        },
      });
  const output = await buildData({
    now,
    fetcher,
    env: sample ? SAMPLE_ENV : process.env,
    config,
    log,
    pastDays: arg('past-days') ? Number(arg('past-days')) : undefined,
    futureDays: Number(arg('future-days') ?? 30),
  });
  await writeOutput(outDir, output);
  const scores = [...output.files.keys()].filter((k) => k.startsWith('scores/')).length;
  console.log(`\n写入 ${outDir}`);
  console.log(`比赛 ${output.matches.length} 场，比分文件 ${scores} 个`);
  for (const s of output.meta.sources) {
    const mark = { ok: '✓', warn: '!', off: '·' }[sourceStatus(s)];
    console.log(`  ${mark} ${s.name}：${s.count} 场${s.note ? `（${s.note}）` : ''}`);
  }
  for (const w of output.warnings) console.warn(`  ! ${w}`);
  const { unknownTeams, possibleDuplicates, hiddenKnockoutTeams } = output.diagnostics;
  if (unknownTeams.length) {
    console.log(`\n目录里没有的球队 ${unknownTeams.length} 个（显示英文原名）：`);
    for (const t of unknownTeams) console.log(`  - [${t.competition}] ${t.name}（${t.source}）`);
  }
  if (hiddenKnockoutTeams) {
    console.log(`另有淘汰赛里目录外的球队名 ${hiddenKnockoutTeams} 个，没有列出（会暴露晋级情况）`);
  }
  if (possibleDuplicates.length) {
    console.warn(`\n可能重复的比赛 ${possibleDuplicates.length} 组：`);
    for (const d of possibleDuplicates) console.warn(`  ! [${d.competition}] ${d.a} ／ ${d.b}`);
  }
  // GitHub Actions：在运行页面上显示一份中文小结（只有场数和球队名，没有比分）
  const summaryPath = envValue(process.env, 'GITHUB_STEP_SUMMARY');
  if (summaryPath && !sample) await appendFile(summaryPath, stepSummary(output, scores));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
