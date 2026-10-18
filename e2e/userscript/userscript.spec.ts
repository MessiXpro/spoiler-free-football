import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext } from '@playwright/test';
import {
  blockExternal,
  expectNoFlash,
  expectVisibleClean,
  flashReport,
  installFlashRecorder,
  serveSite,
  sitePage,
} from '../helpers/flash.ts';
import { SAMPLE_NOW } from '../helpers/spoilers.ts';

const DIST = join(import.meta.dirname, '..', '..', 'apps', 'userscript', 'dist');
const SCRIPT = join(DIST, 'spoiler-free-football.user.js');
const GLOBAL_SCRIPT = join(DIST, 'spoiler-free-football-global.user.js');
const PLANTED = [
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

/**
 * 模拟用户脚本管理器的 GM 存储（跨网站共享），存在 Node 这边的 Map 里。
 * 必须在用户脚本之前注入。
 */
async function installGmShim(context: BrowserContext, store: Map<string, unknown>) {
  await context.exposeBinding(
    '__sffGm',
    (_src, op: 'get' | 'set', key: string, value?: unknown) => {
      if (op === 'set') store.set(key, value);
      return store.get(key);
    },
  );
  // GM.xmlHttpRequest：不受网页跨域/混合内容限制（由 Node 这边代为请求）
  await context.exposeBinding('__sffGmXhr', async (_src, url: string) => {
    const res = await fetch(url);
    return { status: res.status, responseText: await res.text() };
  });
  await context.addInitScript(() => {
    const w = window as unknown as {
      __sffGm: (op: string, k: string, v?: unknown) => Promise<unknown>;
      __sffGmXhr: (url: string) => Promise<{ status: number; responseText: string }>;
      GM: unknown;
    };
    const call = w.__sffGm;
    w.GM = {
      getValue: async (k: string, d?: unknown) => (await call('get', k)) ?? d,
      setValue: async (k: string, v: unknown) => {
        await call('set', k, JSON.parse(JSON.stringify(v)));
      },
      xmlHttpRequest: (d: {
        url: string;
        onload: (r: unknown) => void;
        onerror: (e: unknown) => void;
      }) => {
        w.__sffGmXhr(d.url).then(d.onload, d.onerror);
      },
    };
  });
}

test.describe('用户脚本（.user.js，document-start 注入）', () => {
  test('对照组：没有脚本时，测试工具确实能检测到闪现的比分', async ({ context }) => {
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.bilibili\.com\//, sitePage('bilibili-video.html'));
    await installFlashRecorder(context, PLANTED);
    const page = await context.newPage();
    await page.goto('https://www.bilibili.com/video/BV1xx411c7mD');
    await page.waitForTimeout(300);
    const report = await flashReport(page);
    expect(report.flash.length).toBeGreaterThan(0);
  });

  test('B 站视频页：首次可见无比分，动态内容、标题、时长、弹幕、评论都被处理', async ({
    context,
  }) => {
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.bilibili\.com\//, sitePage('bilibili-video.html'));
    await installFlashRecorder(context, PLANTED);
    await context.addInitScript({ path: SCRIPT });
    const page = await context.newPage();
    await page.goto('https://www.bilibili.com/video/BV1xx411c7mD');
    await page.evaluate(() => (window as unknown as { __pageDone: Promise<void> }).__pageDone);
    await page.waitForTimeout(300);
    await expectNoFlash(page);
    await expectVisibleClean(page);
    await expect(page).toHaveTitle('曼城■-■伊普斯维奇 ■■■_哔哩哔哩_bilibili');
    await expect(page.locator('.bpx-player-ctrl-time-duration')).toBeHidden();
    await expect(page.locator('.bpx-player-row-dm-wrap')).toBeHidden();
    await expect(page.locator('#commentapp')).toBeHidden();
    await expect(page.locator('.rec-list')).toBeHidden();
    await expect(page.locator('#shadow-text')).not.toContainText('3-0');
    await expect(page.locator('#plain')).toHaveText('普通文字 2026 赛季 第 7 轮 4-3-3 阵型 U21');
    await expect(page.getByTestId('sff-fab')).toBeVisible();
  });

  for (const [url, name] of [
    ['https://www.miguvideo.com/p/detail/123456', '咪咕视频'],
    ['https://tv.cctv.com/2026/10/12/VIDEabc.shtml', '央视网'],
    ['https://m.v.qq.com/x/cover/abc.html', '腾讯视频手机版'],
    ['https://m.dongqiudi.com/article/1.html', '懂球帝手机版'],
  ] as const) {
    test(`${name}：首次可见无比分`, async ({ context }) => {
      await blockExternal(context);
      const origin = new URL(url).origin;
      await serveSite(
        context,
        new RegExp(`^${origin.replace(/\./g, '\\.')}/`),
        sitePage('generic-site.html', {
          __TITLE__: `阿森纳2-1切尔西_${name}`,
          __H1__: '英超 阿森纳2-1切尔西',
        }),
      );
      await installFlashRecorder(context, [
        '2-1',
        '2:1',
        '2比1',
        '0-2',
        '3-0',
        '破门',
        '晋级',
        '扳平',
        '梅开二度',
      ]);
      await context.addInitScript({ path: SCRIPT });
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForTimeout(600);
      await expectNoFlash(page);
      await expectVisibleClean(page);
      await expect(page).toHaveTitle('最新：曼城 ■-■ 伊普斯维奇');
    });
  }

  test('手机悬浮面板：临时显示 5 分钟、恢复遮挡', async ({ context }) => {
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.bilibili\.com\//, sitePage('bilibili-video.html'));
    await context.addInitScript({ path: SCRIPT });
    const page = await context.newPage();
    await page.goto('https://www.bilibili.com/video/BV1xx411c7mD');
    await page.getByTestId('sff-fab').click();
    await expect(page.getByTestId('sff-panel')).toBeVisible();
    await page.getByTestId('sff-pause').click();
    await expect(page.locator('h1.video-title')).toContainText('3-0');
    await expect(page.locator('#commentapp')).toBeVisible();
    await page.getByTestId('sff-resume').click();
    await expect(page.locator('h1.video-title')).not.toContainText('3-0');
    // 面板自身的文字不会被遮挡逻辑改动
    await expect(page.getByTestId('sff-pause')).toHaveText('临时显示 5 分钟');
  });

  test('与网页联动（GM 存储跨网站共享）：跳转带比赛、面板里显示比分、网页同步已看', async ({
    context,
  }) => {
    const store = new Map<string, unknown>();
    await installGmShim(context, store);
    await context.addInitScript({ path: SCRIPT });
    await blockExternal(context);
    await serveSite(
      context,
      /^https:\/\/www\.miguvideo\.com\//,
      sitePage('generic-site.html', { __TITLE__: '咪咕视频', __H1__: '全场回放' }),
    );

    const web = await context.newPage();
    await web.clock.setFixedTime(SAMPLE_NOW);
    await web.goto('http://localhost:4173/#/settings');
    await expect(web.getByTestId('shield-status')).toContainText('已检测到用户脚本');
    await web.goto('http://localhost:4173/#/today');
    const card = web.locator(
      '[data-testid=match-card][data-match-id="epl-2026-27-man-city-sunderland"]',
    );
    await card.getByRole('button', { name: '录像 / 集锦入口' }).click();
    const opened = context.waitForEvent('page');
    await card.getByTestId('external-link').filter({ hasText: '咪咕视频' }).first().click();
    const platform = await opened;
    await platform.waitForLoadState('domcontentloaded');
    await expect
      .poll(() => (store.get('settings') as { currentMatch?: { id: string } })?.currentMatch?.id)
      .toBe('epl-2026-27-man-city-sunderland');

    await platform.getByTestId('sff-fab').click();
    await expect(platform.getByTestId('sff-match')).toContainText('曼城 vs 桑德兰');
    await platform.getByTestId('sff-reveal').click();
    await platform.getByTestId('sff-reveal-yes').click();
    const score = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          'apps',
          'web',
          'dist',
          'data',
          'scores',
          'epl-2026-27-man-city-sunderland.json',
        ),
        'utf8',
      ),
    ) as { home: number; away: number };
    await expect(platform.getByTestId('sff-score')).toContainText(`${score.home} - ${score.away}`);

    await web.reload();
    await expect(card.getByTestId('watched-badge')).toBeVisible();
  });

  test('全网版：刚安装就默认开启（时段内普通网站也做通用识别）；关掉后不处理', async ({
    browser,
  }) => {
    const days = [0, 1, 2, 3, 4, 5, 6];
    const cases: Array<{ name: string; stored?: unknown; masked: boolean }> = [
      // 刚安装、没有任何设置：默认时段 06:00–12:00，测试时间是北京时间早上 09:00
      { name: '默认', masked: true },
      {
        name: '关闭',
        stored: { global: { enabled: false, start: '06:00', end: '12:00', days } },
        masked: false,
      },
      {
        name: '全天',
        stored: { global: { enabled: true, start: '00:00', end: '00:00', days } },
        masked: true,
      },
    ];
    for (const c of cases) {
      const context = await browser.newContext({ timezoneId: 'Asia/Shanghai' });
      await context.clock.setFixedTime(SAMPLE_NOW);
      await blockExternal(context);
      await serveSite(context, /^https:\/\/www\.example\.com\//, sitePage('neutral-site.html'));
      if (c.stored) {
        await context.addInitScript((stored: string) => {
          localStorage.setItem('sff-userscript:settings', stored);
        }, JSON.stringify(c.stored));
      }
      await context.addInitScript({ path: GLOBAL_SCRIPT });
      const page = await context.newPage();
      await page.goto('https://www.example.com/');
      await page.waitForTimeout(300);
      if (c.masked) {
        await expect(page.locator('#t'), c.name).toHaveText('Arsenal ■-■ Chelsea');
        await expect(page, c.name).toHaveTitle('Example: Arsenal ■-■ Chelsea');
      } else {
        await expect(page.locator('#t'), c.name).toHaveText('Arsenal 2-1 Chelsea');
      }
      await expect(page.locator('html'), c.name).toHaveClass(/sff-ready/);
      await context.close();
    }
  });
});
