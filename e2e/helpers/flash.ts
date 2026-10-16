import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { findSpoilers } from '../../packages/core/src/index.ts';

export const SITES_DIR = join(import.meta.dirname, '..', 'sites');

export function sitePage(name: string, replace: Record<string, string> = {}): string {
  let html = readFileSync(join(SITES_DIR, name), 'utf8');
  for (const [k, v] of Object.entries(replace)) html = html.split(k).join(v);
  return html;
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** 把站点地址映射到本地测试页（地址栏是真实域名，所以插件/脚本会按真实站点规则运行） */
export async function serveSite(context: BrowserContext, url: string | RegExp, html: string) {
  await context.route(url, (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      : route.fulfill({ contentType: 'image/png', body: PNG_1PX }),
  );
}

/** 其他外部请求一律返回空图片/404，测试完全离线 */
export async function blockExternal(context: BrowserContext) {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ contentType: 'image/png', body: PNG_1PX })
      : route.fulfill({ status: 404, body: '' }),
  );
}

/**
 * 每一帧（requestAnimationFrame，在浏览器绘制之前）检查：
 * 如果页面已经可见，可见文字里是否出现了预先埋下的剧透片段。
 * 用来证明"页面第一次可见时就没有比分"，动态插入的内容也不会闪现。
 */
export async function installFlashRecorder(target: Page | BrowserContext, planted: string[]) {
  await target.addInitScript((markers: string[]) => {
    const w = window as unknown as {
      __flash: Array<{ t: number; text: string }>;
      __frames: number;
      __visibleFrames: number;
    };
    w.__flash = [];
    w.__frames = 0;
    w.__visibleFrames = 0;
    const visible = (el: Element) => {
      const anyEl = el as Element & { checkVisibility?: (o: object) => boolean };
      if (anyEl.checkVisibility) {
        return anyEl.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
      }
      return true;
    };
    const scanRoot = (root: Node, hits: string[]) => {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 1) {
          const sr = (n as Element).shadowRoot;
          if (sr) scanRoot(sr, hits);
          continue;
        }
        const text = (n as Text).data;
        const parent = n.parentElement;
        if (!parent || parent.closest('script,style,title')) continue;
        if (!markers.some((m) => text.includes(m))) continue;
        if (visible(parent)) hits.push(text);
      }
    };
    const tick = () => {
      w.__frames++;
      const html = document.documentElement;
      if (html && document.body && getComputedStyle(html).opacity !== '0') {
        w.__visibleFrames++;
        const hits: string[] = [];
        scanRoot(document.body, hits);
        for (const h of hits) w.__flash.push({ t: Math.round(performance.now()), text: h });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, planted);
}

export async function flashReport(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __flash: Array<{ t: number; text: string }>;
      __frames: number;
      __visibleFrames: number;
    };
    return { flash: w.__flash, frames: w.__frames, visibleFrames: w.__visibleFrames };
  });
}

/** 页面可见文字（含 open shadow root）+ 标题，用核心识别逻辑检查 */
export async function visibleText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) =>
      (el as Element & { checkVisibility: (o: object) => boolean }).checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        checkOpacity: true,
        checkVisibilityCSS: true,
      });
    const scan = (root: Node) => {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 1) {
          const sr = (n as Element).shadowRoot;
          if (sr) scan(sr);
          continue;
        }
        const parent = n.parentElement;
        if (!parent || parent.closest('script,style')) continue;
        if (parent.closest('title') || visible(parent)) {
          const t = (n as Text).data.trim();
          if (t) out.push(t);
        }
      }
    };
    scan(document.documentElement);
    for (const el of document.querySelectorAll('[title],[alt],[aria-label]')) {
      for (const a of ['title', 'alt', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    out.push(document.title);
    return out;
  });
}

export async function expectVisibleClean(page: Page) {
  const hits = (await visibleText(page)).filter(
    (t) => findSpoilers(t, { football: true }).length > 0,
  );
  expect(hits, `可见内容仍有剧透：\n${hits.join('\n')}`).toEqual([]);
}

export async function expectNoFlash(page: Page) {
  const report = await flashReport(page);
  expect(report.frames, '没有记录到任何绘制帧').toBeGreaterThan(5);
  expect(report.visibleFrames, '页面一直没有显示出来').toBeGreaterThan(0);
  expect(report.flash, `比分闪现：${JSON.stringify(report.flash.slice(0, 5))}`).toEqual([]);
}
