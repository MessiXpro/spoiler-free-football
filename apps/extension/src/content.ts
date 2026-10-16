import { bootShield, type ShieldController } from '@sff/core/dom';
import { ext, loadSettings, onSettingsChanged, type TabMessage, type TabStatus } from './api.ts';

/**
 * 内容脚本（document_start）。manifest 里同时注入了 cloak.css：页面先整页透明，
 * 读完设置、处理完已有文字后才显示，避免比分闪现。之后 MutationObserver 持续处理新内容。
 * 全网防剧透模式下由后台用 scripting.registerContentScripts 注入同一个脚本。
 */
async function main() {
  const settings = await loadSettings();
  // manifest 静态注入的是站点模式；后台动态注册的全网模式会先运行 global-flag.js 设置这个标记
  const siteMode = !(globalThis as unknown as { __sffGlobal?: boolean }).__sffGlobal;
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
  let controller: ShieldController = bootShield(document, settings, { siteMode, onStats });

  onSettingsChanged((next) => {
    if (!controller.active && next.enabled) {
      controller = bootShield(document, next, { siteMode, onStats });
    } else {
      controller.update(next);
    }
  });

  ext.runtime.onMessage.addListener((msg: TabMessage, _sender, sendResponse) => {
    if (window !== window.top) return undefined;
    if (msg.type === 'pause') controller.pause(msg.ms);
    if (msg.type === 'resume') controller.resume();
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
