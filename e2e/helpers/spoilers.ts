import { expect, type Page } from '@playwright/test';
import { findSpoilers } from '../../packages/core/src/index.ts';

/** 页面里所有文字（逐个文本节点，避免相邻元素拼出假比分）+ 常见属性 + 标签页标题 */
export async function collectPageText(page: Page): Promise<{ texts: string[]; title: string }> {
  return page.evaluate(() => {
    const texts: string[] = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;
      const t = (n as Text).data.trim();
      if (t) texts.push(t);
    }
    for (const el of document.querySelectorAll('[title],[alt],[aria-label],[placeholder]')) {
      for (const a of ['title', 'alt', 'aria-label', 'placeholder']) {
        const v = el.getAttribute(a);
        if (v) texts.push(v);
      }
    }
    for (const el of document.querySelectorAll('input,textarea')) {
      const v = (el as HTMLInputElement).value;
      if (v) texts.push(v);
    }
    // 整块可见文字也查一遍，覆盖被拆成多个元素的情况
    texts.push(document.body.innerText);
    return { texts, title: document.title };
  });
}

/** 断言页面上没有任何比分写法和结果词（按足球语境，最严格） */
export async function expectNoSpoilers(page: Page, where = '') {
  const { texts, title } = await collectPageText(page);
  const hits: string[] = [];
  for (const t of [...texts, title]) {
    const spans = findSpoilers(t, { football: true });
    if (spans.length) hits.push(`${spans.map((s) => s.text).join('、')} ← ${t.slice(0, 120)}`);
  }
  expect(hits, `页面出现剧透 ${where}\n${hits.join('\n')}`).toEqual([]);
}

/** 北京时间 2026-09-21（周一）09:00，示例数据的"现在" */
export const SAMPLE_NOW = new Date('2026-09-21T01:00:00Z');
