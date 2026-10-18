import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

export const EXTENSION_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'extension',
  'dist',
  'chrome',
);

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
        args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
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

export { expect } from '@playwright/test';
