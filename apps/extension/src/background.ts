import { fetchRemoteRules, defaultRules } from '@sff/core/dom';
import { isNewerRules } from '@sff/core';
import { ext, loadSettings, onSettingsChanged, saveSettings, WEB_MATCHES } from './api.ts';

/**
 * 后台：
 * 1. 每 12 小时从网页部署地址下载 site-rules.json（纯数据），校验后保存——规则更新不需要发新版插件
 * 2. 全网防剧透：用户授权后，动态注册对所有网站生效的内容脚本
 * 3. 角标显示当前页遮挡了多少处
 */
const ALARM = 'sff-rules-update';
const GLOBAL_SCRIPT_ID = 'sff-global';

declare const __SFF_SITE_MATCHES__: string[];

async function updateRules(force = false) {
  const settings = await loadSettings();
  if (
    !force &&
    settings.rulesCheckedAt &&
    Date.now() - settings.rulesCheckedAt < 6 * 60 * 60 * 1000
  )
    return;
  try {
    const remote = await fetchRemoteRules(settings.dataBase);
    const current = settings.rules ?? defaultRules();
    // 不比当前旧、内容又不同就采用：改了规则忘记把 version 改大，已安装的插件也能用上
    const adopt =
      remote &&
      !isNewerRules(current.version, remote.version) &&
      JSON.stringify(remote) !== JSON.stringify(current);
    if (adopt) {
      await saveSettings({ rules: remote, rulesCheckedAt: Date.now() });
    } else {
      await saveSettings({ rulesCheckedAt: Date.now() });
    }
  } catch {
    /* 离线或地址不对，下次再试 */
  }
}

/**
 * 全网模式的动态内容脚本。排除：
 * - 支持的站点（manifest 里已有站点模式的内容脚本）
 * - 防剧透网页本身（否则「看完了，显示比分」显示出来的比分又被遮住）
 */
function globalScript(): chrome.scripting.RegisteredContentScript {
  return {
    id: GLOBAL_SCRIPT_ID,
    matches: ['<all_urls>'],
    excludeMatches: [...new Set([...__SFF_SITE_MATCHES__, ...WEB_MATCHES])],
    js: ['global-flag.js', 'content.js'],
    css: ['cloak.css'],
    runAt: 'document_start',
    allFrames: false,
  };
}

const scriptKey = (s: chrome.scripting.RegisteredContentScript) =>
  JSON.stringify([
    [...(s.matches ?? [])].sort(),
    [...(s.excludeMatches ?? [])].sort(),
    s.js ?? [],
    s.css ?? [],
  ]);

async function syncGlobalScript() {
  const settings = await loadSettings();
  const scripting = ext.scripting;
  if (!scripting?.registerContentScripts) return;
  const registered = await scripting
    .getRegisteredContentScripts({ ids: [GLOBAL_SCRIPT_ID] })
    .catch(() => []);
  const hasPermission = await ext.permissions
    .contains({ origins: ['<all_urls>'] })
    .catch(() => false);
  const want = settings.global.enabled && hasPermission;
  const script = globalScript();
  if (want && !registered.length) {
    await scripting.registerContentScripts([script]);
  } else if (want && registered[0] && scriptKey(registered[0]) !== scriptKey(script)) {
    // 插件更新前注册的脚本（例如没有排除防剧透网页）：按新配置更新
    if (scripting.updateContentScripts) {
      await scripting.updateContentScripts([script]);
    } else {
      await scripting.unregisterContentScripts({ ids: [GLOBAL_SCRIPT_ID] });
      await scripting.registerContentScripts([script]);
    }
  } else if (!want && registered.length) {
    await scripting.unregisterContentScripts({ ids: [GLOBAL_SCRIPT_ID] });
  }
}

ext.runtime.onInstalled.addListener(() => {
  void ext.alarms.create(ALARM, { periodInMinutes: 12 * 60 });
  void updateRules(true);
  void syncGlobalScript();
});

ext.runtime.onStartup?.addListener(() => {
  void updateRules();
  void syncGlobalScript();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void updateRules(true);
});

onSettingsChanged(() => void syncGlobalScript());
ext.permissions.onAdded?.addListener(() => void syncGlobalScript());
ext.permissions.onRemoved?.addListener(() => void syncGlobalScript());

ext.runtime.onMessage.addListener(
  (msg: { type?: string; count?: number }, sender, sendResponse) => {
    if (msg?.type === 'badge' && sender.tab?.id !== undefined) {
      const text = msg.count ? String(Math.min(msg.count, 999)) : '';
      void ext.action.setBadgeText({ tabId: sender.tab.id, text });
      void ext.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#1f8a4c' });
    } else if (msg?.type === 'update-rules') {
      updateRules(true).then(() => sendResponse({ ok: true }));
      return true;
    }
    return undefined;
  },
);
