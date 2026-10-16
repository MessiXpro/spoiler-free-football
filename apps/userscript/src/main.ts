import { isNewerRules, matchSite, validateSiteRules } from '@sff/core';
import {
  bootShield,
  currentMatchFor,
  defaultRules,
  hostMatches,
  installCloak,
  installShadowHook,
  normalizeSettings,
  whenDocumentElement,
  type CurrentMatch,
  type ShieldController,
  type ShieldSettings,
} from '@sff/core/dom';
import { mountPanel } from './panel.ts';
import {
  getJson,
  getValue,
  onValueChange,
  registerMenu,
  setValue,
  storageKind,
} from './storage.ts';

declare const __SFF_WEB_URL__: string;
declare const __SFF_WEB_PREFIXES__: string[];
declare const __SFF_VARIANT__: 'sites' | 'global';

const WEB_URL = __SFF_WEB_URL__;
const DEFAULT_DATA_BASE = new URL('data/', WEB_URL).href;
const KEY = 'settings';

/** 当前页面是不是防剧透网页本身 */
function isWebApp(): boolean {
  const href = location.href;
  return __SFF_WEB_PREFIXES__.some((p) => href.startsWith(p));
}

async function load(): Promise<ShieldSettings> {
  return normalizeSettings(await getValue<Partial<ShieldSettings>>(KEY), DEFAULT_DATA_BASE);
}

async function save(patch: Partial<ShieldSettings>): Promise<ShieldSettings> {
  const next = { ...(await load()), ...patch };
  await setValue(KEY, next);
  return next;
}

// ───────────── 防剧透网页：只做联动 ─────────────
function runBridge() {
  const mark = () => {
    if (!document.documentElement) return false;
    document.documentElement.dataset.sffShield = 'userscript';
    return true;
  };
  if (!mark()) void whenDocumentElement(document).then(mark);
  const target = location.origin === 'null' ? '*' : location.origin;
  const post = (watched: Record<string, number>) =>
    window.postMessage({ source: 'sff-shield', type: 'watched', watched }, target);
  const merge = (a: Record<string, number>, b?: Record<string, number>) => {
    const out = { ...a };
    let changed = false;
    for (const [id, t] of Object.entries(b ?? {})) {
      if (typeof t === 'number' && !out[id]) {
        out[id] = t;
        changed = true;
      }
    }
    return { out, changed };
  };
  window.addEventListener('message', async (e: MessageEvent) => {
    if (e.source !== window) return;
    const d = e.data as {
      source?: string;
      type?: string;
      dataBase?: string;
      watched?: Record<string, number>;
      url?: string;
      liveMode?: boolean;
      match?: Omit<CurrentMatch, 'url' | 'host' | 'at'>;
    } | null;
    if (d?.source !== 'sff-web') return;
    const s = await load();
    if (d.type === 'hello') {
      const patch: Partial<ShieldSettings> = {};
      if (
        typeof d.dataBase === 'string' &&
        /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(d.dataBase)
      ) {
        patch.dataBase = d.dataBase;
      }
      const { out, changed } = merge(s.watched, d.watched);
      if (changed) patch.watched = out;
      if (Object.keys(patch).length) await save(patch);
      post(out);
    } else if (d.type === 'state') {
      const { out, changed } = merge(s.watched, d.watched);
      if (changed) await save({ watched: out });
    } else if (d.type === 'open-match' && d.match && d.url) {
      try {
        const host = new URL(d.url).hostname;
        await save({
          currentMatch: {
            ...d.match,
            url: d.url,
            host,
            at: Date.now(),
            liveMode: Boolean(d.liveMode),
          },
        });
      } catch {
        /* 忽略 */
      }
    }
  });
  onValueChange(KEY, (v) =>
    post(normalizeSettings(v as Partial<ShieldSettings>, DEFAULT_DATA_BASE).watched),
  );
}

// ───────────── 视频/资讯网站：遮挡 ─────────────
async function updateRules(s: ShieldSettings) {
  if (s.rulesCheckedAt && Date.now() - s.rulesCheckedAt < 12 * 60 * 60 * 1000) return;
  try {
    const { status, json } = await getJson(new URL('site-rules.json', s.dataBase).href);
    const remote = status === 200 ? validateSiteRules(json) : null;
    const current = s.rules ?? defaultRules();
    await save(
      remote && isNewerRules(remote.version, current.version)
        ? { rules: remote, rulesCheckedAt: Date.now() }
        : { rulesCheckedAt: Date.now() },
    );
  } catch {
    /* 离线时下次再试 */
  }
}

async function runShield() {
  // 第一件事：同步插入整页遮罩，避免读取设置期间比分闪现
  installCloak(document);
  const unsafe = (globalThis as unknown as { unsafeWindow?: Window & typeof globalThis })
    .unsafeWindow;
  try {
    installShadowHook(unsafe ?? window);
  } catch {
    /* 沙箱环境不允许时忽略 */
  }
  await whenDocumentElement(document);
  let settings = await load();
  const rules = settings.rules ?? defaultRules();
  const siteMode = Boolean(matchSite(rules, location.hostname));
  if (__SFF_VARIANT__ === 'sites' && !siteMode) {
    document.documentElement.classList.add('sff-ready');
    return;
  }
  let controller: ShieldController = bootShield(document, settings, { siteMode });

  const isTop = window === window.top;
  if (isTop && controller.active) {
    const panel = mountPanel({
      controller: () => controller,
      currentMatch: () => currentMatchFor(settings, location.hostname),
      isWatched: (id) => Boolean(settings.watched[id]),
      webUrl: () => settings.dataBase.replace(/data\/?$/, '') || WEB_URL,
      disableSite: async () => {
        settings = await save({ disabledHosts: [...settings.disabledHosts, location.hostname] });
        controller.update(settings);
      },
      revealScore: async (m) => {
        settings = await save({
          watched: { ...settings.watched, [m.id]: Math.floor(Date.now() / 1000) },
        });
        try {
          const { status, json } = await getJson(
            new URL(`scores/${encodeURIComponent(m.id)}.json`, settings.dataBase).href,
          );
          const score = json as {
            id?: string;
            home?: number;
            away?: number;
            extraTime?: boolean;
            penalties?: [number, number];
          } | null;
          if (status !== 200 || !score || score.id !== m.id || typeof score.home !== 'number') {
            return '数据源还没有这场的比分，已记为已看';
          }
          return `${m.home.name} ${score.home} - ${score.away} ${m.away.name}${
            score.penalties ? `（点球 ${score.penalties[0]} - ${score.penalties[1]}）` : ''
          }${score.extraTime ? '（经过加时）' : ''}`;
        } catch (err) {
          return `比分加载失败：${(err as Error).message}`;
        }
      },
    });
    registerMenu('防剧透：临时显示 5 分钟', () => {
      controller.pause(5 * 60 * 1000);
      panel.refresh();
    });
    registerMenu('防剧透：恢复遮挡', () => {
      controller.resume();
      panel.refresh();
    });
    registerMenu('防剧透：在此站点停用', async () => {
      settings = await save({ disabledHosts: [...settings.disabledHosts, location.hostname] });
      controller.update(settings);
    });
  }
  registerMenu('防剧透：在所有站点重新启用', async () => {
    settings = await save({
      disabledHosts: settings.disabledHosts.filter((h) => !hostMatches(location.hostname, h)),
    });
    controller = bootShield(document, settings, { siteMode });
  });
  onValueChange(KEY, (v) => {
    settings = normalizeSettings(v as Partial<ShieldSettings>, DEFAULT_DATA_BASE);
    controller.update(settings);
  });
  if (isTop) void updateRules(settings);
}

if (isWebApp()) {
  runBridge();
} else {
  runShield().catch((err) => {
    document.documentElement?.classList.add('sff-ready');
    console.warn('[防剧透看球]', err, storageKind());
  });
}
