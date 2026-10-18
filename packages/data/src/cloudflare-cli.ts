import { appendFile } from 'node:fs/promises';
import { CloudflareSetupError, ensurePagesProject } from './cloudflare.ts';
import { envValue } from './env.ts';

/**
 * GitHub Actions 里部署到 Cloudflare Pages 之前运行：
 *   CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID（secrets）、CLOUDFLARE_PROJECT（可选，默认 spoiler-free-football）
 * 输出 url=https://<项目>.pages.dev/ 到 GITHUB_OUTPUT，供后面的步骤当作网页地址
 */
async function main() {
  const env = process.env;
  const project = (envValue(env, 'CLOUDFLARE_PROJECT') ?? 'spoiler-free-football').trim();
  const result = await ensurePagesProject({
    token: envValue(env, 'CLOUDFLARE_API_TOKEN'),
    accountId: envValue(env, 'CLOUDFLARE_ACCOUNT_ID'),
    project,
  });
  console.log(
    `${result.created ? '已创建' : '已找到'} Cloudflare Pages 项目「${project}」，网页地址：${result.url}`,
  );
  const output = envValue(env, 'GITHUB_OUTPUT');
  // 项目名也交给部署那一步用（这里已经去掉了首尾空格并检查过格式）
  if (output) await appendFile(output, `url=${result.url}\nproject=${project}\n`);
  const summary = envValue(env, 'GITHUB_STEP_SUMMARY');
  if (summary) await appendFile(summary, `## 网页地址\n\n${result.url}\n\n`);
}

main().catch((err) => {
  const msg = err instanceof CloudflareSetupError ? err.message : String(err);
  // ::error 会显示在运行页面最上面
  console.log(`::error title=Cloudflare Pages 设置有问题::${msg.replace(/\r?\n/g, ' ')}`);
  process.exit(1);
});
