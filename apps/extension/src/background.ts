import { fetchRemoteRules, defaultRules } from '@sff/core/dom';
import { isNewerRules } from '@sff/core';
import { ext, loadSettings, onSettingsChanged, saveSettings } from './api.ts';

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
    if (remote && isNewerRules(remote.version, current.version)) {
      await saveSettings({ rules: remote, rulesCheckedAt: Date.now() });
    } else {
      await saveSettings({ rulesCheckedAt: Date.now() });
    }
  } catch {
    /* 离线或地址不对，下次再试 */
  }
}

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
  if (want && !registered.length) {
    await scripting.registerContentScripts([
      {
        id: GLOBAL_SCRIPT_ID,
        matches: ['<all_urls>'],
        excludeMatches: __SFF_SITE_MATCHES__,
        js: ['global-flag.js', 'content.js'],
        css: ['cloak.css'],
        runAt: 'document_start',
        allFrames: false,
      },
    ]);
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
