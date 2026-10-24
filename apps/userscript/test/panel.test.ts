import type { CurrentMatch, ShieldController } from '@sff/core/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPanel, type PanelActions } from '../src/panel.ts';

/**
 * 直接挂面板、用假的 actions：模拟设置在面板以外被改了（其他标签页、脚本菜单）而面板还没重画。
 * 面板上的按钮要按「显示出来的」状态做事，不能按点击时的实时状态。
 */
const match = (id: string, home: string, away: string): CurrentMatch => ({
  id,
  title: `${home} vs ${away}`,
  competition: 'epl',
  kickoff: '2026-09-21T00:00:00Z',
  home: { id: home.toLowerCase(), name: home },
  away: { id: away.toLowerCase(), name: away },
  url: 'http://localhost:3000/',
  host: 'localhost',
  at: Date.now(),
});

function mount(over: Partial<PanelActions>) {
  const actions: PanelActions = {
    controller: () => ({ active: true, shield: null }) as unknown as ShieldController,
    currentMatch: () => null,
    isWatched: () => false,
    revealScore: async () => '',
    disableSite: async () => {},
    enableSite: async () => {},
    siteDisabled: () => false,
    webUrl: () => 'https://web.example/sff/',
    ...over,
  };
  const p = mountPanel(actions);
  const root = p.host.shadowRoot!;
  const q = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const title = () => root.querySelector('[data-id="title"]')!.textContent;
  q('sff-fab').click();
  return { p, q, title };
}

afterEach(() => {
  for (const el of document.querySelectorAll('sff-panel')) el.remove();
});

describe('面板按钮按显示的状态做事', () => {
  it('写着「在此站点启用」、其实已在别处重新启用：点了只会启用，不会停用', async () => {
    let disabled = true;
    const disableSite = vi.fn(async () => {});
    const enableSite = vi.fn(async () => {});
    const { q } = mount({ siteDisabled: () => disabled, disableSite, enableSite });
    expect(q('sff-toggle-site').textContent).toBe('在此站点启用');
    disabled = false; // 其他标签页重新启用了，面板没重画
    q('sff-toggle-site').click();
    await vi.waitFor(() => expect(q('sff-toggle-site').textContent).toBe('在此站点停用'));
    expect(disableSite).not.toHaveBeenCalled();
    expect(enableSite).toHaveBeenCalledTimes(1);
  });

  it('写着「在此站点停用」、其实已在别处停用：点了不会反过来启用', async () => {
    let disabled = false;
    const disableSite = vi.fn(async () => {});
    const enableSite = vi.fn(async () => {});
    const { q } = mount({ siteDisabled: () => disabled, disableSite, enableSite });
    expect(q('sff-toggle-site').textContent).toBe('在此站点停用');
    disabled = true;
    q('sff-toggle-site').click();
    await vi.waitFor(() => expect(q('sff-toggle-site').textContent).toBe('在此站点启用'));
    expect(enableSite).not.toHaveBeenCalled();
    expect(disableSite).not.toHaveBeenCalled();
  });

  it('加载失败后在别处换了一场：点「再试一次」先换成新比赛，不显示新比赛的比分', async () => {
    let current = match('epl-a', 'Arsenal', 'Chelsea');
    const watched = new Set<string>();
    const revealScore = vi.fn(async (m: CurrentMatch) => {
      watched.add(m.id);
      return '比分加载失败：HTTP 503（已记为已看，可以再试一次）';
    });
    const { q, title } = mount({
      currentMatch: () => current,
      isWatched: (id) => watched.has(id),
      revealScore,
    });
    q('sff-reveal').click();
    q('sff-reveal-yes').click();
    await vi.waitFor(() => expect(q('sff-reveal').textContent).toBe('再试一次'));
    current = match('epl-b', 'Liverpool', 'Everton'); // 面板没重画
    q('sff-reveal').click();
    expect(revealScore).toHaveBeenCalledTimes(1);
    expect(title()).toBe('Liverpool vs Everton');
    expect(q('sff-reveal').hidden).toBe(false);
    expect(q('sff-reveal').textContent).toBe('看完了，显示比分');
    expect(q('sff-reveal-yes').hidden).toBe(true);
    expect(q('sff-score').textContent).toBe('');
  });

  it('比分还在加载时换了一场：加载完也不写到新比赛下面', async () => {
    let current = match('epl-a', 'Arsenal', 'Chelsea');
    let finish!: (text: string) => void;
    const revealScore = vi.fn(() => new Promise<string>((r) => (finish = r)));
    const { p, q, title } = mount({ currentMatch: () => current, revealScore });
    q('sff-reveal').click();
    q('sff-reveal-yes').click();
    expect(q('sff-score').textContent).toBe('加载中…');
    current = match('epl-b', 'Liverpool', 'Everton');
    p.refresh(); // 收到其他标签页的设置变化时 main.ts 会重画面板
    expect(title()).toBe('Liverpool vs Everton');
    expect(q('sff-score').textContent).toBe('');
    finish('Arsenal 2 - 1 Chelsea');
    await new Promise((r) => setTimeout(r, 0));
    expect(q('sff-score').textContent).toBe('');
    expect(q('sff-reveal').hidden).toBe(false);
    expect(q('sff-reveal').textContent).toBe('看完了，显示比分');
  });
});
