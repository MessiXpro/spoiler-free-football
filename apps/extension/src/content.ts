import { matchSite } from '@sff/core';
import { bootShield, defaultRules, type ShieldController } from '@sff/core/dom';
import {
  ext,
  loadSettings,
  onSettingsChanged,
  WEB_MATCHES,
  type TabMessage,
  type TabStatus,
} from './api.ts';
import { isWebAppUrl } from './web-match.ts';

/**
 * 内容脚本（document_start）。manifest 里同时注入了 cloak.css：页面先整页透明，
 * 读完设置、处理完已有文字后才显示，避免比分闪现。之后 MutationObserver 持续处理新内容。
 * 全网防剧透模式下由后台用 scripting.registerContentScripts 注入同一个脚本。
 */
async function main() {
  // manifest 静态注入的是站点模式；后台动态注册的全网脚本会先运行 global-flag.js 设置这个标记
  const injectedGlobal = Boolean((globalThis as unknown as { __sffGlobal?: boolean }).__sffGlobal);
  // 全网模式不处理防剧透网页本身：用户点「看完了，显示比分」后显示的比分不能再被遮住
  // （后台注册时已经排除了这些地址，这里再兜一次底，和用户脚本的 isWebApp() 一致）
  if (injectedGlobal && isWebAppUrl(location.href, WEB_MATCHES)) {
    document.documentElement?.classList.add('sff-ready');
    return;
  }
  const settings = await loadSettings();
  // 全网脚本注入的页面若在下载来的规则里已有站点规则（规则发布后新增的站点），仍按站点模式工作，和用户脚本一致
  const siteMode =
    !injectedGlobal || Boolean(matchSite(settings.rules ?? defaultRules(), location.hostname));
  // 角标最多每秒更新一次（弹幕等内容会频繁触发）
  let lastBadge = -1;
  let badgeTimer: ReturnType<typeof setTimeout> | null = null;
  let pending = 0;
  const onStats = (stats: { texts: number; blocks: number }) => {
    if (window !== window.top) return;
    pending = stats.texts + stats.blocks;
    if (badgeTimer) return;
    badgeTimer = setTimeout(() => {
      badgeTimer = null;
      if (pending === lastBadge) return;
      lastBadge = pending;
      void ext.runtime.sendMessage({ type: 'badge', count: pending }).catch(() => {});
    }, 1000);
  };
  const controller: ShieldController = bootShield(document, settings, { siteMode, onStats });

  // 控制器自己会在设置从关闭变为开启、或进入全网时段时重新启动
  onSettingsChanged((next) => controller.update(next));

  ext.runtime.onMessage.addListener((msg: TabMessage, _sender, sendResponse) => {
    // 临时显示/恢复对所有 frame 生效（B 站等把播放器、评论放在 iframe 里）；状态只由顶层页面回复
    if (msg.type === 'pause') controller.pause(msg.ms);
    if (msg.type === 'resume') controller.resume();
    if (window !== window.top) return undefined;
    const stats = controller.shield?.stats;
    const status: TabStatus = {
      active: controller.active,
      reason: controller.reason,
      site: controller.site?.name ?? null,
      football: stats?.football ?? false,
      texts: stats?.texts ?? 0,
      blocks: stats?.blocks ?? 0,
      paused: stats?.paused ?? false,
      currentMatch: controller.currentMatch,
    };
    sendResponse(status);
    return undefined;
  });
}

main().catch((err) => {
  // 出错时宁可显示页面，也不能让页面一直空白
  document.documentElement?.classList.add('sff-ready');
  console.warn('[防剧透看球]', err);
});
