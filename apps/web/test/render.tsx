import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Program, PublicMatch } from '@sff/core';
import type { AppData } from '../src/lib/data.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted = new Set<() => Promise<void>>();

/** 在 jsdom 里渲染组件；返回容器和卸载函数 */
export async function render(node: ReactNode) {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(node));
  const unmount = async () => {
    if (!mounted.delete(unmount)) return;
    await act(async () => root.unmount());
    el.remove();
  };
  mounted.add(unmount);
  return { el, unmount };
}

/** 卸载所有还挂着的组件（放在 afterEach 里，避免上一个用例的组件继续订阅 store） */
export async function cleanup() {
  for (const unmount of [...mounted]) await unmount();
  document.body.innerHTML = '';
}

export async function click(el: Element | null | undefined) {
  if (!el) throw new Error('要点击的元素不存在');
  await act(async () => (el as HTMLElement).click());
}

/** 等异步请求和随后的状态更新完成 */
export async function settle(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export const q = (root: ParentNode, testId: string) =>
  root.querySelector(`[data-testid="${testId}"]`);
export const qa = (root: ParentNode, testId: string) => [
  ...root.querySelectorAll(`[data-testid="${testId}"]`),
];
export const cardOf = (root: ParentNode, id: string) =>
  root.querySelector(`[data-testid=match-card][data-match-id="${id}"]`);
export const buttonByText = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

export function match(
  partial: Partial<PublicMatch> & Pick<PublicMatch, 'id' | 'kickoff'>,
): PublicMatch {
  return {
    competition: 'epl',
    season: '2026-27',
    stage: 'regular',
    matchday: 7,
    home: { id: 'arsenal', name: 'Arsenal' },
    away: { id: 'chelsea', name: 'Chelsea' },
    status: 'scheduled',
    links: [],
    sources: ['test'],
    ...partial,
  };
}

export function appData(matches: PublicMatch[], programs: Program[] = []): AppData {
  return { matches, programs, episodes: [], meta: null, broadcast: null };
}

/** 和 e2e 一样逐个文本节点检查（避免相邻元素拼出假比分） */
export function textNodes(root: Node): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n as Text).data.trim();
    if (t) out.push(t);
  }
  return out;
}
