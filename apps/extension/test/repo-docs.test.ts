import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 部署工作流和 README 里跟插件/脚本相关的约定（这些文件没有自己的测试包） */
const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const readme = read('README.md');

describe('数据更新与部署工作流', () => {
  const yml = read('.github', 'workflows', 'deploy.yml');

  it('定时任务每天给自己续期一次，公开仓库 60 天没提交也不会被 GitHub 停用', () => {
    const job = /\n {2}keepalive:\n([\s\S]*?)(?=\n {2}\S|\n?$)/.exec(yml)?.[1] ?? '';
    expect(job).toContain('actions: write');
    expect(job).toMatch(
      /gh api -X PUT "repos\/\$\{\{ github\.repository \}\}\/actions\/workflows\/deploy\.yml\/enable"/,
    );
    // 条件里引用的 cron 必须真的存在，否则改了时间表之后续期就悄悄失效了
    const cron = /github\.event\.schedule == '([^']+)'/.exec(job)?.[1];
    expect(cron).toBeDefined();
    expect(yml).toContain(`- cron: '${cron}'`);
    expect(readme).toContain('Enable workflow');
  });
});

describe('README', () => {
  it('开发命令能直接运行：pnpm 自带 ci 命令，脚本要用 pnpm run ci', () => {
    expect(readme).not.toMatch(/^pnpm ci\b/m);
    expect(readme).toMatch(/^pnpm run ci\b/m);
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.ci).toBeDefined();
  });

  it('改站点规则时提醒修改 version', () => {
    const row = readme.split('\n').find((l) => l.includes('default-site-rules.json')) ?? '';
    expect(row).toContain('`version`');
  });
});
