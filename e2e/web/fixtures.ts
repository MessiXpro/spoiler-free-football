import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, type Page } from '@playwright/test';
import { SAMPLE_NOW } from '../helpers/spoilers.ts';

export const DIST_DATA = join(import.meta.dirname, '..', '..', 'apps', 'web', 'dist', 'data');

export function readSample<T>(path: string): T {
  return JSON.parse(readFileSync(join(DIST_DATA, path), 'utf8')) as T;
}

/** 固定"现在"为示例数据的时间，并拦截所有外部请求（测试完全离线） */
export async function preparePage(page: Page, now = SAMPLE_NOW) {
  await page.clock.setFixedTime(now);
  // 用 context 级拦截，新开的标签页（跳转平台）也不会真的联网
  await page.context().route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

export const test = base.extend<{ scoreRequests: string[] }>({
  scoreRequests: [
    async ({ page }, use) => {
      const urls: string[] = [];
      page.on('request', (req) => {
        if (req.url().includes('/data/scores/')) urls.push(req.url());
      });
      await preparePage(page);
      await use(urls);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

export const MATCH_IDS = {
  city: 'epl-2026-27-man-city-sunderland',
  liverpool: 'epl-2026-27-bournemouth-liverpool',
  derby: 'laliga-2026-27-atletico-real-madrid',
  united: 'epl-2026-27-fulham-man-utd',
};

export const card = (page: Page, id: string) =>
  page.locator(`[data-testid=match-card][data-match-id="${id}"]`);
