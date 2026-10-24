import { NOT_SCORE_DATA } from '@sff/core';
import { ATTR_UI, type CurrentMatch, type ShieldController } from '@sff/core/dom';

/**
 * 手机上没有插件弹窗，所以在页面右下角放一个小按钮「防」，点开是迷你面板：
 * 临时显示 / 恢复、在此站点停用 / 启用、正在看的比赛「看完了，显示比分」；全网版还能改全网防剧透时段。
 * 面板放在 shadow root 里并带 data-sff-ui 标记，遮挡逻辑不会处理它，页面样式也不会影响它。
 */
export interface PanelActions {
  controller: () => ShieldController;
  currentMatch: () => CurrentMatch | null;
  isWatched: (id: string) => boolean;
  revealScore: (match: CurrentMatch) => Promise<string>;
  disableSite: () => Promise<void>;
  /** 停用后在面板里重新启用（手机上的脚本管理器大多没有脚本菜单） */
  enableSite: () => Promise<void>;
  siteDisabled: () => boolean;
  webUrl: () => string;
  /** 全网版：查看/修改全网防剧透时段（手机上的脚本管理器大多没有脚本菜单，只能在这里改） */
  globalWindow?: {
    get: () => { start: string; end: string };
    save: (start: string, end: string) => Promise<string>;
  };
}

const STYLE = `
:host { all: initial; }
.fab { position: fixed; right: 14px; bottom: 84px; z-index: 2147483647; width: 40px; height: 40px; border-radius: 20px;
  background: #1f8a4c; color: #fff; border: 0; font: 600 16px/40px sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.3); cursor: pointer; opacity: .85; }
.panel { position: fixed; right: 12px; bottom: 132px; z-index: 2147483647; width: min(300px, calc(100vw - 24px));
  background: #fff; color: #13241a; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.3); padding: 12px; font: 14px/1.5 -apple-system, sans-serif; }
.panel[hidden] { display: none; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
button.b { font: inherit; padding: 6px 10px; border-radius: 8px; border: 1px solid #c9d8ce; background: #f3f7f4; color: inherit; }
button.p { background: #1f8a4c; color: #fff; border-color: transparent; }
input[type=time] { font: inherit; padding: 4px 6px; border-radius: 8px; border: 1px solid #c9d8ce; }
.muted { color: #557161; font-size: 12px; }
.score { font-weight: 700; font-size: 16px; margin-top: 6px; }
@media (prefers-color-scheme: dark) { .panel { background: #16291e; color: #e8f3ec; } button.b { background: #1d3426; border-color: #2a4535; } .muted { color: #9db8a7; } }
`;

export function mountPanel(actions: PanelActions) {
  const host = document.createElement('sff-panel');
  host.setAttribute(ATTR_UI, '');
  host.setAttribute('data-testid', 'sff-userscript-panel');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>
    <button class="fab" part="fab" data-testid="sff-fab" aria-label="防剧透">防</button>
    <div class="panel" hidden data-testid="sff-panel">
      <div><strong>防剧透看球</strong> <span class="muted" data-id="status"></span></div>
      <div class="row">
        <button class="b" data-id="pause" data-testid="sff-pause">临时显示 5 分钟</button>
        <button class="b" data-id="resume" data-testid="sff-resume" hidden>恢复遮挡</button>
        <button class="b" data-id="disable" data-testid="sff-toggle-site">在此站点停用</button>
      </div>
      <div data-id="match" hidden data-testid="sff-match">
        <div class="muted" style="margin-top:10px">正在看</div>
        <div data-id="title"></div>
        <div class="row">
          <button class="b p" data-id="reveal" data-testid="sff-reveal">看完了，显示比分</button>
          <button class="b p" data-id="confirm" data-testid="sff-reveal-yes" hidden>确定显示</button>
        </div>
        <div class="score" data-id="score" data-testid="sff-score"></div>
      </div>
      <div data-id="global" hidden data-testid="sff-global">
        <div class="muted" style="margin-top:10px">全网防剧透时段（00:00 到 00:00 表示全天）</div>
        <div class="row">
          <input type="time" data-id="g-start" data-testid="sff-global-start" />
          <span>到</span>
          <input type="time" data-id="g-end" data-testid="sff-global-end" />
          <button class="b" data-id="g-save" data-testid="sff-global-save">保存</button>
        </div>
        <div class="muted" data-id="g-msg"></div>
      </div>
      <div class="row"><a data-id="web" target="_blank" rel="noopener">打开防剧透网页</a></div>
    </div>`;
  const $ = (id: string) => root.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const fab = root.querySelector('.fab') as HTMLButtonElement;
  const panel = root.querySelector('.panel') as HTMLElement;

  const refresh = () => {
    const c = actions.controller();
    const stats = c.shield?.stats;
    // 全网时段已结束、这个页面的遮挡还在（保持到刷新）：临时显示/恢复照常可用
    const working = c.active || Boolean(c.holding);
    $('status').textContent = !working
      ? (c.reason ?? '未启用')
      : stats?.paused
        ? '已临时显示'
        : c.holding
          ? '全网时段已结束，这个页面的遮挡保持到刷新'
          : `已遮挡 ${(stats?.texts ?? 0) + (stats?.blocks ?? 0)} 处`;
    $('pause').hidden = !working || Boolean(stats?.paused);
    $('resume').hidden = !working || !stats?.paused;
    $('disable').textContent = actions.siteDisabled() ? '在此站点启用' : '在此站点停用';
    const m = actions.currentMatch();
    $('match').hidden = !m;
    if (m) {
      $('title').textContent = m.title;
      ($('reveal') as HTMLButtonElement).textContent = actions.isWatched(m.id)
        ? '查看比分'
        : '看完了，显示比分';
    }
    ($('web') as HTMLAnchorElement).href = actions.webUrl();
  };

  const gw = actions.globalWindow;
  $('global').hidden = !gw;
  /** 打开面板时填入当前时段（refresh 经常被调用，不能覆盖正在输入的值） */
  const fillGlobal = () => {
    if (!gw) return;
    const { start, end } = gw.get();
    ($('g-start') as HTMLInputElement).value = start;
    ($('g-end') as HTMLInputElement).value = end;
    $('g-msg').textContent = '';
  };

  fab.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) fillGlobal();
    refresh();
  });
  $('g-save').addEventListener('click', async () => {
    if (!gw) return;
    const start = ($('g-start') as HTMLInputElement).value;
    const end = ($('g-end') as HTMLInputElement).value;
    $('g-msg').textContent = await gw.save(start, end);
  });
  $('pause').addEventListener('click', () => {
    actions.controller().pause(5 * 60 * 1000);
    refresh();
  });
  $('resume').addEventListener('click', () => {
    actions.controller().resume();
    refresh();
  });
  $('disable').addEventListener('click', async () => {
    await (actions.siteDisabled() ? actions.enableSite() : actions.disableSite());
    refresh();
  });
  const show = async () => {
    const m = actions.currentMatch();
    if (!m) return;
    $('reveal').hidden = true;
    $('confirm').hidden = true;
    $('score').textContent = '加载中…';
    const text = await actions.revealScore(m);
    $('score').textContent = text;
    // 加载失败（已记为已看）：可以再试一次，不用刷新视频页（会打断播放）
    if (text.startsWith('比分加载失败') || text.startsWith(NOT_SCORE_DATA)) {
      $('reveal').textContent = '再试一次';
      $('reveal').hidden = false;
    }
  };
  $('reveal').addEventListener('click', () => {
    const m = actions.currentMatch();
    if (m && actions.isWatched(m.id)) void show();
    else {
      $('reveal').hidden = true;
      $('confirm').hidden = false;
    }
  });
  $('confirm').addEventListener('click', () => void show());

  const attach = () => (document.body ?? document.documentElement).appendChild(host);
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });
  return { refresh, host };
}
