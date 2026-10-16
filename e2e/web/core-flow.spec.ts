import { expectNoSpoilers } from '../helpers/spoilers.ts';
import { card, expect, MATCH_IDS, readSample, test } from './fixtures.ts';

test.describe('昨夜今晨 → 集锦/录像 → 看完显示比分', () => {
  test('默认视图：北京时间、按开球时间排序、只有订阅范围、没有任何剧透', async ({
    page,
    scoreRequests,
  }) => {
    await page.goto('./#/today');
    const cards = page
      .getByTestId('view-today')
      .locator('.match-grid')
      .first()
      .getByTestId('match-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toHaveAttribute('data-match-id', MATCH_IDS.liverpool);
    await expect(cards.nth(1)).toHaveAttribute('data-match-id', MATCH_IDS.city);
    await expect(cards.nth(2)).toHaveAttribute('data-match-id', MATCH_IDS.derby);
    await expect(cards.nth(3)).toHaveAttribute('data-match-id', MATCH_IDS.united);
    // 中性标题：主队 vs 客队 · 赛事 · 轮次 · 开球时间
    await expect(cards.nth(1)).toHaveAttribute(
      'aria-label',
      '曼城 vs 桑德兰 · 英超 · 第5轮 · 9月20日 周日 21:00',
    );
    await expect(cards.nth(2)).toContainText('马竞');
    await expect(cards.nth(2)).toContainText('北京时间 9月20日 周日 22:15');
    // 状态只有 未开始/进行中/已结束
    for (const s of await page.getByTestId('match-status').allTextContents()) {
      expect(['未开始', '进行中', '已结束', '延期/取消']).toContain(s);
    }
    await expect(page).toHaveTitle('昨夜今晨 · 防剧透看球');
    await expectNoSpoilers(page, '（首屏）');
    expect(scoreRequests).toEqual([]);
  });

  test('录像/集锦入口：只链接正版平台；没装插件时先提醒', async ({ page, scoreRequests }) => {
    await page.goto('./#/today');
    const c = card(page, MATCH_IDS.city);
    await c.getByRole('button', { name: '录像 / 集锦入口' }).click();
    const links = c.getByTestId('external-link');
    await expect(links.first()).toBeVisible();
    for (const href of await links.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href),
    )) {
      expect(new URL(href).hostname).toMatch(
        /(miguvideo\.com|bilibili\.com|iqiyi\.com|cctv\.com|yangshipin\.cn)$/,
      );
    }
    await expect(c).toContainText('咪咕视频');
    await links.first().click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('还没有开启防剧透插件或脚本');
    await page.getByTestId('confirm-cancel').click();
    await expectNoSpoilers(page, '（展开入口后）');
    expect(scoreRequests).toEqual([]);
  });

  test('页内播放集锦：中性封面、不显示时长、B 站嵌入关闭弹幕', async ({ page, scoreRequests }) => {
    await page.goto('./#/today');
    const c = card(page, MATCH_IDS.city);
    await c.getByTestId('play-highlights').click();
    const cover = c.getByTestId('embed-play');
    await expect(cover).toBeVisible();
    await expect(cover).toContainText('曼城 vs 桑德兰');
    await expect(cover).not.toContainText(/\d{1,2}:\d{2}/);
    await expectNoSpoilers(page, '（中性封面）');
    await cover.click();
    const iframe = c.getByTestId('embed-iframe');
    const src = new URL((await iframe.getAttribute('src'))!);
    expect(src.hostname).toBe('player.bilibili.com');
    expect(src.searchParams.get('bvid')).toBe('BV1sffSample');
    expect(src.searchParams.get('danmaku')).toBe('0');
    expect(src.searchParams.get('t')).toBe('0');
    await expect(c.getByTestId('embed-mask')).toBeVisible();
    expect(scoreRequests).toEqual([]);
  });

  test('直播模式面板不含剧透', async ({ page }) => {
    await page.goto('./#/today');
    await card(page, MATCH_IDS.derby).getByTestId('live-mode').click();
    await expect(page.getByTestId('live-mode-panel')).toContainText('从开球前开始看全场录像');
    await expectNoSpoilers(page, '（直播模式）');
  });

  test('看完了，显示比分：二次确认后才请求比分，并记为已看', async ({ page, scoreRequests }) => {
    await page.goto('./#/today');
    const c = card(page, MATCH_IDS.city);
    await c.getByTestId('reveal-button').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('确定显示比分吗？');
    // 弹出确认框时还没请求比分，页面上也没有比分
    expect(scoreRequests).toEqual([]);
    await expectNoSpoilers(page, '（确认框）');
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
    expect(scoreRequests).toEqual([]);

    await c.getByTestId('reveal-button').click();
    await page.getByTestId('confirm-ok').click();
    const expected = readSample<{ home: number; away: number }>(`scores/${MATCH_IDS.city}.json`);
    await expect(c.getByTestId('score-display')).toContainText(
      `${expected.home} - ${expected.away}`,
    );
    await expect(c.getByTestId('watched-badge')).toBeVisible();
    expect(scoreRequests).toHaveLength(1);
    expect(scoreRequests[0]).toContain(`/data/scores/${MATCH_IDS.city}.json`);

    // 其他比赛的比分仍然不可见
    await expect(card(page, MATCH_IDS.derby).getByTestId('score-display')).toHaveCount(0);

    // 刷新后已看状态还在；再看比分不需要确认
    await page.reload();
    const again = card(page, MATCH_IDS.city);
    await expect(again.getByTestId('watched-badge')).toBeVisible();
    await expect(again.getByTestId('score-display')).toHaveCount(0);
    await again.getByTestId('reveal-button').click();
    await expect(again.getByTestId('score-display')).toBeVisible();
  });

  test('标记为没看后，比分重新藏起来', async ({ page }) => {
    await page.goto('./#/today');
    const c = card(page, MATCH_IDS.liverpool);
    await c.getByTestId('reveal-button').click();
    await page.getByTestId('confirm-ok').click();
    await expect(c.getByTestId('score-display')).toBeVisible();
    await c.getByRole('button', { name: '藏起比分并标记为没看' }).click();
    await expect(c.getByTestId('score-display')).toHaveCount(0);
    await expect(c.getByTestId('watched-badge')).toHaveCount(0);
    await expectNoSpoilers(page, '（重新藏起后）');
  });

  test('前一晚导航、比赛详情页、即将开始、没看完都不含剧透', async ({ page, scoreRequests }) => {
    await page.goto('./#/today');
    await page.getByTestId('prev-night').click();
    await expect(page.getByTestId('night-range')).toContainText('9月19日');
    await expectNoSpoilers(page, '（前一晚）');
    await page.goto(`./#/match/${MATCH_IDS.derby}`);
    await expect(page.getByTestId('view-match')).toContainText('马竞');
    await expectNoSpoilers(page, '（详情）');
    // 示例数据里接下来一周恰好没有订阅比赛（国家队比赛周），把范围调到 30 天
    await page.goto('./#/settings');
    await page.getByTestId('upcoming-days').selectOption('30');
    await page.goto('./#/upcoming');
    await expect(page.getByTestId('view-upcoming').getByTestId('match-card').first()).toBeVisible();
    for (const s of await page.getByTestId('match-status').allTextContents())
      expect(s).toBe('未开始');
    await expectNoSpoilers(page, '（即将开始）');
    await page.goto('./#/unwatched');
    await expect(
      page.getByTestId('view-unwatched').getByTestId('match-card').first(),
    ).toBeVisible();
    await expectNoSpoilers(page, '（没看完）');
    await page.goto('./#/about');
    await expect(page.getByTestId('view-about')).toContainText('咪咕视频');
    await expectNoSpoilers(page, '（去哪看）');
    expect(scoreRequests).toEqual([]);
  });

  test('比分数据缺失时提示，并记为已看', async ({ page }) => {
    await page.route('**/data/scores/**', (route) =>
      route.fulfill({ status: 404, body: 'not found' }),
    );
    await page.goto('./#/today');
    const c = card(page, MATCH_IDS.united);
    await c.getByTestId('reveal-button').click();
    await page.getByTestId('confirm-ok').click();
    await expect(c.getByTestId('score-missing')).toBeVisible();
    await expect(c.getByTestId('watched-badge')).toBeVisible();
  });
});
