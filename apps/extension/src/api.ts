import { normalizeSettings, type ShieldSettings } from '@sff/core/dom';

/** Chrome 用 chrome.*，Firefox 也支持 chrome.*（MV3 下返回 Promise）；优先用 browser.* */
export const ext: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ?? globalThis.chrome;

declare const __SFF_WEB_URL__: string;
/** 构建时注入的默认网页地址（数据和比分从这里下载；用户打开网页后会自动更新为实际地址） */
export const DEFAULT_WEB_URL =
  typeof __SFF_WEB_URL__ === 'string'
    ? __SFF_WEB_URL__
    : 'https://messixpro.github.io/spoiler-free-football/';
export const DEFAULT_DATA_BASE = new URL('data/', DEFAULT_WEB_URL).href;

declare const __SFF_WEB_MATCHES__: string[];
/** 构建时注入的防剧透网页地址（match pattern）：桥接脚本在这些页面运行，全网模式不处理这些页面 */
export const WEB_MATCHES: string[] =
  typeof __SFF_WEB_MATCHES__ !== 'undefined' ? __SFF_WEB_MATCHES__ : [`${DEFAULT_WEB_URL}*`];

const KEY = 'settings';

export async function loadSettings(): Promise<ShieldSettings> {
  const got = (await ext.storage.local.get(KEY)) as { settings?: Partial<ShieldSettings> };
  return normalizeSettings(got.settings, DEFAULT_DATA_BASE);
}

export async function saveSettings(patch: Partial<ShieldSettings>): Promise<ShieldSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await ext.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: ShieldSettings) => void) {
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) {
      cb(normalizeSettings(changes[KEY].newValue as Partial<ShieldSettings>, DEFAULT_DATA_BASE));
    }
  });
}

/** 内容脚本 ↔ 弹窗之间的消息 */
export type TabMessage = { type: 'status' } | { type: 'pause'; ms: number } | { type: 'resume' };

export interface TabStatus {
  active: boolean;
  reason?: string;
  site: string | null;
  football: boolean;
  texts: number;
  blocks: number;
  paused: boolean;
  currentMatch: ShieldSettings['currentMatch'] | null;
}
