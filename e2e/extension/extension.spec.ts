import {
  blockExternal,
  expectNoFlash,
  expectVisibleClean,
  installFlashRecorder,
  serveSite,
  sitePage,
} from '../helpers/flash.ts';
import { expect, test } from './fixtures.ts';

/** 测试页里埋下的剧透片段 */
const PLANTED_VIDEO = [
  '3-0',
  '3:0',
  '3比0',
  '2:1',
  '帽子戏法',
  '梅开二度',
  '绝杀',
  '破门',
  '零封',
  '逆转',
  '戴帽',
  '晋级',
  '点球大战',
  '取胜',
  '1:52:30',
  '1:23:45',
];

test.describe('浏览器插件（Chrome MV3，加载已解压的扩展）', () => {
  test('B 站视频页：首次可见时没有比分；动态内容、标题、shadow DOM 都被处理', async ({
    context,
    background,
  }) => {
    expect(background.url()).toContain('background.js');
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.bilibili\.com\//, sitePage('bilibili-video.html'));
    await installFlashRecorder(context, PLANTED_VIDEO);
    const page = await context.newPage();
    await page.goto('https://www.bilibili.com/video/BV1xx411c7mD');
    await page.evaluate(() => (window as unknown as { __pageDone: Promise<void> }).__pageDone);
    await page.waitForTimeout(300);

    await expectNoFlash(page);
    await expectVisibleClean(page);

    // 标签页标题（含脚本后改的）
    await expect(page).toHaveTitle('曼城■-■伊普斯维奇 ■■■_哔哩哔哩_bilibili');
    // 视频总时长、进度条预览、弹幕、评论区、相关推荐
    await expect(page.locator('.bpx-player-ctrl-time-duration')).toBeHidden();
    await expect(page.locator('.bpx-player-progress-popup')).toHaveCSS('opacity', '0');
    await expect(page.locator('.bpx-player-row-dm-wrap')).toBeHidden();
    await expect(page.locator('#commentapp')).toBeHidden();
    await expect(page.locator('.rec-list')).toBeHidden();
    // 正文、属性、拆开的比分、shadow root
    await expect(page.locator('h1.video-title')).toHaveText(
      '【英超】曼城 ■-■ 伊普斯维奇 ■■■ 全场集锦',
    );
    expect(await page.locator('h1.video-title').getAttribute('title')).not.toContain('3-0');
    await expect(page.locator('.score-line')).toHaveAttribute('data-sff-hide', 'score');
    await expect(page.locator('#late-plain')).not.toContainText('3:0');
    await expect(page.locator('#shadow-text')).not.toContainText('3-0');
    // 中性内容不受影响
    await expect(page.locator('#plain')).toHaveText('普通文字 2026 赛季 第 7 轮 4-3-3 阵型 U21');
  });

  test('B 站首页信息流：只给足球卡片换封面、藏时长，不影响其他视频', async ({ context }) => {
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.bilibili\.com\//, sitePage('bilibili-home.html'));
    await installFlashRecorder(context, ['2-1', '1-0', '绝杀', '建功']);
    const page = await context.newPage();
    await page.goto('https://www.bilibili.com/');
    await page.waitForTimeout(800);
    await expectNoFlash(page);
    for (const id of ['card-football', 'card-spoiler', 'card-late']) {
      const card = page.locator(`#${id}`);
      await expect(card).toHaveAttribute('data-sff-card', '');
      await expect(card.locator('img')).toHaveCSS('opacity', '0');
      await expect(card.locator('.bili-video-card__stats__duration')).toBeHidden();
    }
    const cooking = page.locator('#card-cooking');
    await expect(cooking).not.toHaveAttribute('data-sff-card', '');
    await expect(cooking.locator('img')).toHaveCSS('opacity', '1');
    await expect(cooking.locator('.bili-video-card__stats__duration')).toBeVisible();
    await expect(page.locator('#card-spoiler h3')).toHaveText('利物浦■-■埃弗顿 ■■■');
  });

  const SITES: Array<[string, string]> = [
    ['https://www.miguvideo.com/p/detail/123456', '咪咕视频'],
    ['https://www.yangshipin.cn/video/home?vid=abc', '央视频'],
    ['https://tv.cctv.com/2026/10/12/VIDEabc.shtml', '央视网'],
    ['https://www.iqiyi.com/v_abc.html', '爱奇艺'],
    ['https://v.qq.com/x/cover/abc.html', '腾讯视频'],
    ['https://www.dongqiudi.com/articles/123.html', '懂球帝'],
    ['https://news.zhibo8.com/zuqiu/2026-10-12/abc.htm', '直播吧'],
    ['https://bbs.hupu.com/123.html', '虎扑'],
  ];
  for (const [url, name] of SITES) {
    test(`${name}：首次可见无比分，标题、列表、比分牌、评论、动态内容都被处理`, async ({
      context,
    }) => {
      await blockExternal(context);
      const origin = new URL(url).origin;
      await serveSite(
        context,
        new RegExp(`^${origin.replace(/\./g, '\\.')}/`),
        sitePage('generic-site.html', {
          __TITLE__: `英超 阿森纳2-1切尔西 全场回放_${name}`,
          __H1__: '英超第7轮 阿森纳2-1切尔西',
        }),
      );
      await installFlashRecorder(context, [
        '2-1',
        '2:1',
        '2比1',
        '(4)1-1(3)',
        '0-2',
        '3-0',
        '破门',
        '晋级',
        '扳平',
        '梅开二度',
        '点球大战',
      ]);
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForTimeout(700);
      await expectNoFlash(page);
      await expectVisibleClean(page);
      await expect(page).toHaveTitle('最新：曼城 ■-■ 伊普斯维奇');
      await expect(page.locator('#late a')).not.toContainText('0-2');
      await expect(page.locator('.match-score')).toBeHidden();
      await expect(page.locator('#neutral')).toHaveText('2025-26 赛季 第 3 轮 U21 4-3-3 阵型');
    });
  }

  test('不在支持列表、也没开全网模式的网站：完全不处理', async ({ context }) => {
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.example\.com\//, sitePage('neutral-site.html'));
    const page = await context.newPage();
    await page.goto('https://www.example.com/');
    await expect(page.locator('#t')).toHaveText('Arsenal 2-1 Chelsea');
    await expect(page).toHaveTitle('Example: Arsenal 2-1 Chelsea');
  });

  test('弹窗：状态、一键临时显示、恢复、总开关', async ({ context, extensionId }) => {
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.bilibili\.com\//, sitePage('bilibili-video.html'));
    const page = await context.newPage();
    await page.goto('https://www.bilibili.com/video/BV1xx411c7mD');
    await page.waitForTimeout(500);
    const tabId = await context.serviceWorkers()[0]!.evaluate(async () => {
      const [t] = await chrome.tabs.query({ url: 'https://www.bilibili.com/*' });
      return t!.id!;
    });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await expect(popup.getByTestId('site-status')).toContainText('哔哩哔哩');
    await expect(popup.getByTestId('site-status')).toContainText('足球页面');

    await popup.getByTestId('pause').click();
    await expect(popup.getByTestId('site-status')).toContainText('已临时显示');
    await expect(page.locator('h1.video-title')).toContainText('3-0');
    await expect(page.locator('#commentapp')).toBeVisible();

    await popup.getByTestId('resume').click();
    await expect(page.locator('h1.video-title')).not.toContainText('3-0');
    await expect(page.locator('#commentapp')).toBeHidden();

    // 总开关关闭后，新打开的页面不再处理
    await popup.getByTestId('enabled').uncheck();
    const page2 = await context.newPage();
    await page2.goto('https://www.bilibili.com/video/BV1xx411c7mD');
    await expect(page2.locator('h1.video-title')).toContainText('3-0');
  });
});
