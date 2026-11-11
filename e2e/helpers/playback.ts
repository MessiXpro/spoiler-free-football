import { expect, type Page, type Worker } from '@playwright/test';
import { DEFAULT_SITE_RULES_JSON } from '../../packages/core/src/index.ts';

/** 咪咕回放页（测试页 e2e/sites/migu-replay.html 映射到这个地址，节目 id 是假的） */
export const MIGU_REPLAY_URL = 'https://www.miguvideo.com/p/live/120000000001';
export const FIRST_FULL_REPLAY = '全场回放（解说甲、解说乙）';

/**
 * 这次构建内置的站点规则（带回放条 playback），版本号改到最大。插件装好时后台会下载一次线上的规则
 * （后台的请求不经过 context.route，线上规则可能还没有 playback），先等它写完再换成这份，测试结果不随线上规则变
 */
export async function pinExtensionRules(background: Worker) {
  const rules = { ...DEFAULT_SITE_RULES_JSON, version: '9999-12-31' };
  const checked = () =>
    background.evaluate(async () =>
      Boolean((await chrome.storage.local.get('settings')).settings?.rulesCheckedAt),
    );
  for (let end = Date.now() + 10_000; Date.now() < end && !(await checked());) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await background.evaluate(async (next) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...settings, rules: next, rulesCheckedAt: Date.now() },
    });
  }, rules);
}

interface PageClick {
  text: string;
  trusted: boolean;
  at: number;
}
const clicksOn = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clicks: PageClick[] }).__clicks);
const withoutTime = (clicks: PageClick[]) => clicks.map(({ text, trusted }) => ({ text, trusted }));

/**
 * 打开回放页：回放条先出来、播放器后挂载好。等播放器好了才切到第一个全场回放（之前点会丢，播放器一直转圈），
 * 播放器真的在放全场回放；只点了这一下、没有跳转。之后用户自己点全场集锦，集锦照常播，不会被切回去
 */
export async function expectSwitchesToFullReplay(page: Page) {
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await page.goto(MIGU_REPLAY_URL);
  const active = page.locator('.match-review__slide.is-active');
  const nowPlaying = page.getByTestId('now-playing');
  const playerProgram = page.getByTestId('player-program');
  await expect(playerProgram).toHaveText(FIRST_FULL_REPLAY);
  await expect(active).toHaveText(FIRST_FULL_REPLAY);
  await expect(nowPlaying).toHaveText(FIRST_FULL_REPLAY);
  const first = await clicksOn(page);
  expect(withoutTime(first)).toEqual([{ text: FIRST_FULL_REPLAY, trusted: false }]);
  const playerAt = await page.evaluate(
    () => (window as unknown as { __playerAt: number }).__playerAt,
  );
  expect(first[0]!.at).toBeGreaterThanOrEqual(playerAt);

  await page.locator('.match-review__slide', { hasText: '全场集锦' }).click();
  await expect(playerProgram).toHaveText('全场集锦');
  await page.waitForTimeout(1500);
  await expect(active).toHaveText('全场集锦');
  await expect(nowPlaying).toHaveText('全场集锦');
  await expect(playerProgram).toHaveText('全场集锦');
  expect(withoutTime(await clicksOn(page))).toEqual([
    { text: FIRST_FULL_REPLAY, trusted: false },
    { text: '全场集锦', trusted: true },
  ]);
  expect(navigations).toEqual([MIGU_REPLAY_URL]);
}
