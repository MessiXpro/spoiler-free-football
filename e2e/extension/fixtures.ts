import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test';

export const EXTENSION_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'extension',
  'dist',
  'chrome',
);

/**
 * 浏览器完全离线，测试用的是插件自带的规则：
 * - 插件一装好，后台就去网页部署地址下载远程规则（每 12 小时一次）。后台 service worker 的请求不经过 context.route；
 *   Playwright 1.56 只在设了 PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS 时才拦截它，而且路由要等浏览器启动后才装得上，
 *   不能保证赶在安装时那次下载之前。不拦的话测试跑的其实是线上部署的规则，结果跟着线上变
 * - 所以在浏览器这一层把除 localhost（测试用的网页）以外的主机名都解析成不存在；页面请求照常由各测试的 route 返回，
 *   不需要解析主机名
 * - 不走系统或环境变量里的代理：走代理时主机名由代理解析，上面的规则拦不住
 */
const OFFLINE_ARGS = [
  '--no-proxy-server',
  '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost',
];

/** 每个测试一个独立的浏览器配置目录，加载"已解压的扩展程序" */
export const test = base.extend<{
  context: BrowserContext;
  background: Worker;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(
      mkdtempSync(join(tmpdir(), 'sff-ext-')),
      {
        channel: 'chromium',
        headless: true,
        args: [
          `--disable-extensions-except=${EXTENSION_DIR}`,
          `--load-extension=${EXTENSION_DIR}`,
          ...OFFLINE_ARGS,
        ],
      },
    );
    await use(context);
    await context.close();
  },
  background: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ background }, use) => {
    await use(background.url().split('/')[2]!);
  },
});

/**
 * 换成测试用的站点规则。后台的规则检查是排队进行的：从插件自己的设置页发一次「检查更新」，
 * 收到回复时安装时的那次检查一定已经结束（不设时限，等到为止），之后再写入就不会被它覆盖。
 * 离线时两次检查都下载失败、什么都不写；要是下载到了远程规则（离线设置失效了），在这里就报错
 */
export async function useRules(context: BrowserContext, background: Worker, rules: unknown) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${background.url().split('/')[2]}/options.html`);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update-rules' }));
  await page.close();
  const before = await background.evaluate(
    async () => (await chrome.storage.local.get('settings')).settings ?? {},
  );
  expect(before.rulesCheckedAt, '测试不能联网下载远程规则').toBeUndefined();
  expect(before.rules, '测试不能联网下载远程规则').toBeUndefined();
  await background.evaluate(async (next) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...settings, rules: next, rulesCheckedAt: Date.now() },
    });
  }, rules);
}

export { expect };
