import type { PublicMatch } from '../../packages/core/src/index.ts';
import { expectNoSpoilers } from '../helpers/spoilers.ts';
import { card, expect, preparePage, readSample, test } from './fixtures.ts';

test.describe('节目防剧透', () => {
  test('相关比赛没看完时节目折叠；展开后显示正版链接；国内无正版的只标注', async ({ page }) => {
    await page.goto('./#/programs');
    const txzq = page.locator('[data-testid=program-card][data-program-id=txzq]');
    await expect(txzq.getByTestId('program-locked')).toBeVisible();
    await expect(txzq.getByTestId('program-link')).toHaveCount(0);
    await expectNoSpoilers(page, '（节目页）');

    await txzq.getByTestId('unlock-program').click();
    await page.getByTestId('confirm-ok').click();
    await expect(txzq.getByTestId('program-link').first()).toBeVisible();
    await expect(txzq).toContainText('央视网');
    await expect(txzq).toContainText('天下足球 · 9月14日（周一）');

    const unavailable = page.getByTestId('programs-unavailable');
    await expect(unavailable).toContainText('Match of the Day');
    await expect(unavailable).toContainText('国内无正版');
    await expect(unavailable.locator('a')).toHaveCount(0);
    await expect(page.locator('[data-program-id=gjoz]')).toContainText('疑似停播');
    await expectNoSpoilers(page, '（展开节目后）');
  });
});

test.describe('淘汰赛对阵锁定', () => {
  test('上一轮没看完时，下一轮队名藏起来；手动显示需要确认', async ({ page }) => {
    const base = readSample<{ matches: PublicMatch[] }>('matches.json');
    const r16: PublicMatch = {
      id: 'ucl-2026-27-round-of-16-psv-arsenal',
      competition: 'ucl',
      season: '2026-27',
      stage: 'round-of-16',
      leg: 2,
      kickoff: '2026-09-15T19:00:00.000Z',
      home: { id: 'psv', name: 'PSV埃因霍温' },
      away: { id: 'arsenal', name: '阿森纳' },
      status: 'scheduled',
      links: [],
      sources: ['test'],
    };
    const qf: PublicMatch = {
      ...r16,
      id: 'ucl-2026-27-quarter-final-arsenal-bayern',
      stage: 'quarter-final',
      leg: 1,
      kickoff: '2026-09-23T19:00:00.000Z',
      home: { id: 'arsenal', name: '阿森纳' },
      away: { id: 'bayern', name: '拜仁' },
    };
    await page.route('**/data/matches.json', (route) =>
      route.fulfill({ json: { generatedAt: '', matches: [...base.matches, r16, qf] } }),
    );
    await page.goto('./#/upcoming');
    const locked = card(page, qf.id);
    await expect(locked.getByTestId('locked-teams')).toBeVisible();
    // 对阵本身不显示（对手「拜仁」不出现）；锁定卡列出的是没看完的上一轮（1/8决赛 PSV vs 阿森纳），
    // 这是用户自己订阅的那场、赛前就公开的对阵，不是剧透
    await expect(locked).not.toContainText('拜仁');
    // 页面结构里也没有由队名拼成的比赛编号
    await expect(locked).not.toHaveAttribute('data-match-id', /.*/);
    await expect(locked.getByTestId('lock-blockers')).toContainText('1/8决赛');
    await expect(locked.getByTestId('lock-blockers').locator('a')).toHaveAttribute(
      'href',
      /#\/match\/ucl-2026-27-round-of-16-psv-arsenal/,
    );
    await expectNoSpoilers(page, '（锁定的对阵）');

    await locked.getByTestId('unlock-fixture').click();
    await page.getByTestId('confirm-ok').click();
    await expect(locked).toContainText('拜仁');

    // 看完上一轮后自动解锁（清空手动解锁记录后重新加载）
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(card(page, qf.id).getByTestId('locked-teams')).toBeVisible();
    await page.goto('./#/unwatched');
    await card(page, r16.id).getByTestId('reveal-button').click();
    await page.getByTestId('confirm-ok').click();
    // 卡片留在「没看完」里显示结果（这场示例数据没有比分文件，显示"还没有比分"的提示）
    await expect(
      card(page, r16.id).locator('[data-testid=score-display],[data-testid=score-missing]'),
    ).toBeVisible();
    await expect(card(page, r16.id).getByTestId('watched-badge')).toBeVisible();
    await page.goto('./#/upcoming');
    await expect(card(page, qf.id)).toContainText('拜仁');
  });

  test('进行中的比赛显示「进行中」，没有显示比分按钮', async ({ page }) => {
    await preparePage(page, new Date('2026-09-20T14:00:00Z'));
    await page.goto('./#/match/epl-2026-27-man-city-sunderland');
    const c = card(page, 'epl-2026-27-man-city-sunderland');
    await expect(c.getByTestId('match-status')).toHaveText('进行中');
    await expect(c.getByTestId('reveal-button')).toHaveCount(0);
    await expectNoSpoilers(page, '（进行中）');
  });
});
