import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockExternal, serveSite, sitePage } from '../helpers/flash.ts';
import { SAMPLE_NOW } from '../helpers/spoilers.ts';
import { expect, test } from './fixtures.ts';

const CITY = 'epl-2026-27-man-city-sunderland';
const score = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', 'apps', 'web', 'dist', 'data', 'scores', `${CITY}.json`),
    'utf8',
  ),
) as { home: number; away: number };

test('网页 → 插件联动：跳转时带上比赛；在插件弹窗里显示比分后，网页同步为已看', async ({
  context,
  extensionId,
}) => {
  await blockExternal(context);
  await serveSite(
    context,
    /^https:\/\/www\.miguvideo\.com\//,
    sitePage('generic-site.html', { __TITLE__: '咪咕视频', __H1__: '全场回放' }),
  );

  const web = await context.newPage();
  await web.clock.setFixedTime(SAMPLE_NOW);
  await web.goto('http://localhost:4173/#/settings');
  await expect(web.getByTestId('shield-status')).toContainText('已检测到浏览器插件');
  await web.goto('http://localhost:4173/#/today');

  const card = web.locator(`[data-testid=match-card][data-match-id="${CITY}"]`);
  await card.getByRole('button', { name: '录像 / 集锦入口' }).click();
  const migu = card.getByTestId('external-link').filter({ hasText: '咪咕视频' }).first();
  const popupPromise = context.waitForEvent('page');
  await migu.click();
  const platform = await popupPromise;
  await platform.waitForLoadState('domcontentloaded');
  expect(platform.url()).toContain('miguvideo.com');

  // 插件记下了"正在看哪一场"
  const sw = context.serviceWorkers()[0]!;
  const stored = await sw.evaluate(
    async () => (await chrome.storage.local.get('settings')).settings,
  );
  expect(stored.currentMatch.id).toBe(CITY);
  expect(stored.dataBase).toBe('http://localhost:4173/data/');

  const tabId = await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ url: 'https://www.miguvideo.com/*' });
    return t!.id!;
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await expect(popup.getByTestId('current-match')).toContainText('曼城 vs 桑德兰');
  await expect(popup.getByTestId('popup-score')).toHaveText('');
  await popup.getByTestId('popup-reveal').click();
  await popup.getByTestId('popup-reveal-yes').click();
  await expect(popup.getByTestId('popup-score')).toContainText(`${score.home} - ${score.away}`);

  // 网页上自动变成已看（插件通过页面里的桥接脚本通知网页）
  await web.bringToFront();
  await expect(card.getByTestId('watched-badge')).toBeVisible();
  await expect(card.getByTestId('score-display')).toHaveCount(0);
});

test('网页上显示比分 → 插件里也记为已看；标记为没看 → 插件里也删掉', async ({ context }) => {
  await blockExternal(context);
  const web = await context.newPage();
  await web.clock.setFixedTime(SAMPLE_NOW);
  await web.goto('http://localhost:4173/#/today');
  const card = web.locator(
    '[data-testid=match-card][data-match-id="laliga-2026-27-atletico-real-madrid"]',
  );
  await card.getByTestId('reveal-button').click();
  await web.getByTestId('confirm-ok').click();
  await expect(card.getByTestId('score-display')).toBeVisible();
  const sw = context.serviceWorkers()[0]!;
  await expect
    .poll(async () =>
      sw.evaluate(async () =>
        Object.keys((await chrome.storage.local.get('settings')).settings?.watched ?? {}),
      ),
    )
    .toContain('laliga-2026-27-atletico-real-madrid');

  // 网页上「藏起比分并标记为没看」→ 插件里也删掉，刷新网页后不会被插件加回来
  await card.getByRole('button', { name: '藏起比分并标记为没看' }).click();
  await expect(card.getByTestId('watched-badge')).toHaveCount(0);
  await expect
    .poll(async () =>
      sw.evaluate(async () =>
        Object.keys((await chrome.storage.local.get('settings')).settings?.watched ?? {}),
      ),
    )
    .not.toContain('laliga-2026-27-atletico-real-madrid');
  await web.reload();
  await expect(card).toBeVisible();
  await web.waitForTimeout(500);
  await expect(card.getByTestId('watched-badge')).toHaveCount(0);
});
