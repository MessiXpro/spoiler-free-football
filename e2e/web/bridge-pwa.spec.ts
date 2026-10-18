import { expect, test } from '@playwright/test';
import { card, MATCH_IDS, preparePage } from './fixtures.ts';

test.describe('与插件/用户脚本联动', () => {
  test.beforeEach(async ({ page }) => {
    await preparePage(page);
    // 模拟插件：页面最早期打标记，并记录网页发来的消息
    await page.addInitScript(() => {
      (window as unknown as { __msgs: unknown[] }).__msgs = [];
      // 初始化脚本运行时 <html> 可能还没创建
      const mark = () => {
        if (!document.documentElement) return false;
        document.documentElement.dataset.sffShield = 'extension';
        return true;
      };
      if (!mark()) {
        new MutationObserver((_, o) => {
          if (mark()) o.disconnect();
        }).observe(document, { childList: true });
      }
      window.addEventListener('message', (e) => {
        const d = e.data as { source?: string };
        if (d?.source === 'sff-web') (window as unknown as { __msgs: unknown[] }).__msgs.push(d);
      });
    });
  });

  test('检测到插件；跳转时告诉插件要看哪一场', async ({ page, context }) => {
    await page.goto('./#/settings');
    await expect(page.getByTestId('shield-status')).toContainText('已检测到浏览器插件');
    await page.goto('./#/today');
    const c = card(page, MATCH_IDS.city);
    await c.getByRole('button', { name: '录像 / 集锦入口' }).click();
    const popup = context.waitForEvent('page');
    await c.getByTestId('external-link').first().click();
    await (await popup).close();
    const msgs = await page.evaluate(
      () => (window as unknown as { __msgs: Array<Record<string, unknown>> }).__msgs,
    );
    expect(msgs.some((m) => m.type === 'hello' && typeof m.dataBase === 'string')).toBe(true);
    const open = msgs.find((m) => m.type === 'open-match') as {
      match: { id: string; title: string };
      url: string;
    };
    expect(open.match.id).toBe(MATCH_IDS.city);
    expect(open.match.title).toContain('曼城 vs 桑德兰');
    expect(open.url).toMatch(/^https:\/\//);
  });

  test('在插件里显示了比分 → 网页同步为已看；网页上显示比分 → 通知插件', async ({ page }) => {
    await page.goto('./#/today');
    await expect(card(page, MATCH_IDS.derby).getByTestId('watched-badge')).toHaveCount(0);
    await page.evaluate((id) => {
      window.postMessage(
        { source: 'sff-shield', type: 'watched', watched: { [id]: 1790000000 } },
        location.origin,
      );
    }, MATCH_IDS.derby);
    await expect(card(page, MATCH_IDS.derby).getByTestId('watched-badge')).toBeVisible();

    await card(page, MATCH_IDS.city).getByTestId('reveal-button').click();
    await page.getByTestId('confirm-ok').click();
    await expect
      .poll(async () =>
        page.evaluate(
          (id) =>
            (
              window as unknown as {
                __msgs: Array<{ type: string; watched?: Record<string, number> }>;
              }
            ).__msgs.some((m) => m.type === 'state' && Boolean(m.watched?.[id])),
          MATCH_IDS.city,
        ),
      )
      .toBe(true);
  });
});

test.describe('PWA', () => {
  test('manifest、图标和 service worker', async ({ browser, request }) => {
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    await preparePage(page);
    await page.goto('./#/today');
    const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
    const manifest = await (await request.get(manifestHref!)).json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    for (const icon of manifest.icons as Array<{ src: string }>) {
      expect((await request.get(icon.src)).ok()).toBe(true);
    }
    expect((await request.get('icons/apple-touch-icon.png')).ok()).toBe(true);
    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg.active);
    });
    expect(registered).toBe(true);
    const sw = await (await request.get('sw.js')).text();
    expect(sw).toContain('index.html');
    expect(sw).not.toContain('scores/');
    await context.close();
  });
});
