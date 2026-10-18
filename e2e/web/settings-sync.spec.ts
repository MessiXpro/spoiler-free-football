import { expectNoSpoilers } from '../helpers/spoilers.ts';
import { card, expect, MATCH_IDS, preparePage, test } from './fixtures.ts';

test.describe('订阅增删', () => {
  test('取消订阅曼城后不再显示；赛事设为「全部比赛」后显示其他场次', async ({ page }) => {
    await page.goto('./#/settings');
    await expect(page.getByTestId('team-man-city')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('team-man-city').click();
    await expect(page.getByTestId('team-man-city')).toHaveAttribute('aria-pressed', 'false');
    await page.goto('./#/today');
    await expect(card(page, MATCH_IDS.liverpool)).toBeVisible();
    await expect(card(page, MATCH_IDS.city)).toHaveCount(0);

    await page.goto('./#/settings');
    await page.getByTestId('comp-epl').selectOption('all');
    await page.goto('./#/today');
    await expect(card(page, MATCH_IDS.city)).toBeVisible();
    await expect(card(page, 'epl-2026-27-leeds-crystal-palace')).toBeVisible();

    await page.goto('./#/settings');
    await page.getByTestId('comp-epl').selectOption('off');
    await page.goto('./#/today');
    await expect(card(page, MATCH_IDS.liverpool)).toHaveCount(0);
    await expect(card(page, MATCH_IDS.derby)).toBeVisible();
  });

  test('搜索并订阅新球队（中文或英文）', async ({ page }) => {
    await page.goto('./#/settings');
    await page.getByTestId('team-search').fill('Leeds');
    await page.getByTestId('team-leeds').click();
    await page.getByTestId('team-search').fill('水晶宫');
    await page.getByTestId('team-crystal-palace').click();
    await page.goto('./#/today');
    await expect(card(page, 'epl-2026-27-leeds-crystal-palace')).toBeVisible();
    await expectNoSpoilers(page);
  });

  test('设置页覆盖英超、西甲全部球队和国家队', async ({ page }) => {
    await page.goto('./#/settings');
    for (const id of ['team-coventry', 'team-racing', 'team-nt-netherlands', 'team-nt-argentina']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expectNoSpoilers(page, '（设置）');
  });
});

test.describe('同步码', () => {
  test('导出 → 在另一台设备（新浏览器上下文）导入：订阅和已看记录都带过去', async ({
    page,
    browser,
  }) => {
    await page.goto('./#/today');
    const c = card(page, MATCH_IDS.derby);
    await c.getByTestId('reveal-button').click();
    await page.getByTestId('confirm-ok').click();
    await expect(c.getByTestId('watched-badge')).toBeVisible();

    await page.goto('./#/settings');
    await page.getByTestId('team-leeds').click();
    await page.getByTestId('export-code').click();
    const code = await page.getByTestId('sync-code').inputValue();
    expect(code).toMatch(/^SFF[01]\.[A-Za-z0-9_-]+$/);
    await expectNoSpoilers(page, '（导出同步码后）');

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await preparePage(page2);
    await page2.goto('./#/settings');
    await expect(page2.getByTestId('team-leeds')).toHaveAttribute('aria-pressed', 'false');
    await page2.getByTestId('import-input').fill(code);
    await page2.getByTestId('import-button').click();
    await expect(page2.getByTestId('confirm-dialog')).toContainText('已看记录：1 场');
    await page2.getByTestId('confirm-ok').click();
    await expect(page2.getByTestId('sync-message')).toHaveText('导入完成');
    await expect(page2.getByTestId('team-leeds')).toHaveAttribute('aria-pressed', 'true');
    await page2.goto('./#/today');
    await expect(card(page2, MATCH_IDS.derby).getByTestId('watched-badge')).toBeVisible();
    await expect(card(page2, MATCH_IDS.city).getByTestId('watched-badge')).toHaveCount(0);
    await other.close();
  });

  test('同步链接：打开即提示导入', async ({ page, browser }) => {
    await page.goto('./#/today');
    await card(page, MATCH_IDS.united).getByTestId('reveal-button').click();
    await page.getByTestId('confirm-ok').click();
    await page.goto('./#/settings');
    await page.getByTestId('export-code').click();
    const code = await page.getByTestId('sync-code').inputValue();

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await preparePage(page2);
    await page2.goto(`./#/import/${code}`);
    await expect(page2.getByTestId('confirm-dialog')).toBeVisible();
    await page2.getByTestId('confirm-ok').click();
    await expect(page2.getByTestId('import-done')).toBeVisible();
    await page2.goto('./#/today');
    await expect(card(page2, MATCH_IDS.united).getByTestId('watched-badge')).toBeVisible();
    await other.close();
  });

  test('损坏的同步码给出中文提示', async ({ page }) => {
    await page.goto('./#/settings');
    await page.getByTestId('import-input').fill('SFF1.这不是同步码');
    await page.getByTestId('import-button').click();
    await expect(page.getByTestId('sync-message')).toContainText(/损坏|不完整|无效/);
  });
});
