import { existsSync, readFileSync } from 'node:fs';
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

  it('私有仓库跳过的定时运行都真的存在，且至少还剩早上两次和晚上一次', () => {
    const crons = [...yml.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]);
    const referenced = [...yml.matchAll(/github\.event\.schedule == '([^']+)'/g)].map((m) => m[1]);
    for (const c of referenced) expect(crons).toContain(c);
    const quota = /- id: quota\n([\s\S]*?)(?=\n {6}- )/.exec(yml)?.[1] ?? '';
    const skipped = [...quota.matchAll(/github\.event\.schedule == '([^']+)'/g)].map((m) => m[1]);
    expect(skipped.length).toBeGreaterThan(0);
    expect(crons.filter((c) => !skipped.includes(c)).length).toBeGreaterThanOrEqual(3);
    expect(yml).toContain("needs.hosting.outputs.skip != 'true'");
    // 非 PR 的运行不能在整个工作流上共用一个队列：跳过的运行会顶掉正在排队的正式运行
    const top = /\nconcurrency:\n {2}group: ([^\n]+)/.exec(yml)?.[1] ?? '';
    expect(top).toContain('github.run_id');
    const build = /\n {2}build:\n([\s\S]*?)(?=\n {2}\S|\n?$)/.exec(yml)?.[1] ?? '';
    expect(build).toMatch(/concurrency:\n\s+group: deploy-build-/);
  });

  it('正式构建插件/脚本时设置 SFF_RELEASE=1（不带 localhost 地址）', () => {
    for (const f of ['deploy.yml', 'release.yml']) {
      const text = read('.github', 'workflows', f);
      expect(text, f).toMatch(/SFF_RELEASE: '1'/);
    }
  });

  it('定时任务的事件里没有 repository 信息：网页地址不能用 github.event.repository', () => {
    expect(yml).not.toContain('github.event.repository');
  });
});

describe('版本号', () => {
  it('所有 package.json 的版本号一致（用户脚本 @version、插件 manifest、发布标签都靠它）', () => {
    const files = [
      'package.json',
      'apps/extension/package.json',
      'apps/userscript/package.json',
      'apps/web/package.json',
      'apps/sync-worker/package.json',
      'packages/core/package.json',
      'packages/data/package.json',
    ];
    const versions = files.map(
      (f) => (JSON.parse(read(...f.split('/'))) as { version: string }).version,
    );
    expect(new Set(versions).size, versions.join(', ')).toBe(1);
    // 发布工作流检查的也是这几个文件
    const release = read('.github', 'workflows', 'release.yml');
    for (const f of files) expect(release).toContain(`'${f}'`);
  });
});

describe('README', () => {
  it('开发命令能直接运行：pnpm 自带 ci 命令，脚本要用 pnpm run ci', () => {
    expect(readme).not.toMatch(/^pnpm ci\b/m);
    expect(readme).toMatch(/^pnpm run ci\b/m);
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.ci).toBeDefined();
  });

  it('改站点规则不用手动改 version（部署时自动盖上提交时间）', () => {
    const row = readme.split('\n').find((l) => l.includes('default-site-rules.json')) ?? '';
    expect(row).toContain('不用改 `version`');
    const yml = read('.github', 'workflows', 'deploy.yml');
    expect(yml).toContain('SFF_RULES_STAMP=');
    expect(yml).toMatch(/fetch-depth: 0/);
    // git log 的路径写错时输出为空、步骤照样成功：路径必须是真的规则文件，取不到时这一步要失败
    const p = /git log -1 --format=%cI -- (\S+?)\)?"/.exec(yml)?.[1];
    expect(p).toBe('packages/core/src/rules/default-site-rules.json');
    expect(existsSync(join(ROOT, p!))).toBe(true);
    expect(yml).toMatch(/\[ -n "\$stamp" \] \|\| \{[^}]*exit 1; \}/);
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
