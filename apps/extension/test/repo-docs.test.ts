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
    // 续期放在 hosting job 里（不多占一个 job 的计费分钟）
    const job = /\n {2}hosting:\n([\s\S]*?)(?=\n {2}\S|\n?$)/.exec(yml)?.[1] ?? '';
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

  it('定时任务的事件里没有 repository 信息：网页地址不能用 github.event.repository', () => {
    expect(yml).not.toContain('github.event.repository');
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

describe('Cloudflare Pages 部署', () => {
  const yml = read('.github', 'workflows', 'deploy.yml');

  it('先准备好 Pages 项目（放在数据管线前面，填错几秒就失败），项目名默认值两边一致', () => {
    const prepare = yml.indexOf('pnpm --filter @sff/data run cloudflare:prepare');
    expect(prepare).toBeGreaterThan(0);
    expect(prepare).toBeLessThan(yml.indexOf('pnpm data:build'));
    // 网页地址要在构建插件/脚本之前确定（它们会把地址写进去）
    expect(yml.indexOf('steps.cloudflare.outputs.url')).toBeLessThan(
      yml.indexOf('pnpm --filter @sff/extension build'),
    );
    const pkg = JSON.parse(read('packages', 'data', 'package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['cloudflare:prepare']).toBeDefined();
    // 上传用的项目名就是准备那一步检查过的（不再各写一份默认值）
    expect(yml).toContain('PROJECT: ${{ steps.cloudflare.outputs.project }}');
    expect(yml).toContain('--project-name "$PROJECT"');
    expect(read('packages', 'data', 'src', 'cloudflare-cli.ts')).toContain(
      "?? 'spoiler-free-football'",
    );
  });
});
