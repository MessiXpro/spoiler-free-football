import { isNewerRules, matchSite, NOT_SCORE_DATA, scorePath, validateSiteRules } from '@sff/core';
import {
  applyWebWatched,
  bootShield,
  currentMatchFor,
  defaultRules,
  hostDisabledBy,
  installCloak,
  installShadowHook,
  normalizeSettings,
  whenDocumentElement,
  type CurrentMatch,
  type ShieldController,
  type ShieldSettings,
  watchedAfterKickoff,
} from '@sff/core/dom';
import { mountPanel } from './panel.ts';
import { isTimeValue, parseTimeWindow } from './schedule.ts';
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
/** 父页面通知 iframe 里的脚本临时显示/恢复 */
const FRAME_MSG = 'sff-userscript-frames';
const MAX_PAUSE = 5 * 60 * 1000;

/** 当前页面是不是防剧透网页本身 */
function isWebApp(): boolean {
  const href = location.href;
  return __SFF_WEB_PREFIXES__.some((p) => href.startsWith(p));
}

async function load(): Promise<ShieldSettings> {
  const raw = await getValue<Partial<ShieldSettings>>(KEY);
  const s = normalizeSettings(raw, DEFAULT_DATA_BASE);
  // 全网版：装了这个版本就是要全网防剧透，没设置过时默认开启（时段用默认的 06:00–12:00）；
  // 用户自己关掉的保持关闭
  if (__SFF_VARIANT__ === 'global' && typeof raw?.global?.enabled !== 'boolean') {
    s.global = { ...s.global, enabled: true };
  }
  return s;
}

/**
 * 基于存储里最新的设置合并后写入。不能展开内存里的 settings：没有 addValueChangeListener 的管理器
 * （Via、X浏览器、iOS Userscripts）里它可能早已过时，会把其他标签页写的「已看」「停用站点」整个覆盖掉
 */
async function save(
  patch: Partial<ShieldSettings> | ((cur: ShieldSettings) => Partial<ShieldSettings>),
): Promise<ShieldSettings> {
  const cur = await load();
  const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
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
  // Tampermonkey 等沙箱里脚本的 window 是个包装对象，网页 postMessage 的 e.source 是页面的 window（unsafeWindow）
  const unsafe = (globalThis as unknown as { unsafeWindow?: Window }).unsafeWindow;
  window.addEventListener('message', async (e: MessageEvent) => {
    if ((e.source !== window && e.source !== unsafe) || e.origin !== location.origin) return;
    const d = e.data as {
      source?: string;
      type?: string;
      dataBase?: string;
      watched?: Record<string, number>;
      unwatched?: Record<string, number>;
      ids?: string[];
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
      const { watched, changed } = applyWebWatched(s.watched, d);
      if (changed) patch.watched = watched;
      if (Object.keys(patch).length) await save(patch);
      post(watched);
    } else if (d.type === 'state' || d.type === 'unwatch') {
      const { watched, changed } = applyWebWatched(s.watched, d);
      if (changed) await save({ watched });
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
            hideExtras: Boolean(d.match.hideExtras),
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
    // 不比当前旧、内容又不同就采用：改了规则忘记把 version 改大，已安装的脚本也能用上
    const adopt =
      remote &&
      !isNewerRules(current.version, remote.version) &&
      JSON.stringify(remote) !== JSON.stringify(current);
    await save(
      adopt ? { rules: remote, rulesCheckedAt: Date.now() } : { rulesCheckedAt: Date.now() },
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
  // 页面上已有另一份在防剧透（插件 + 脚本，或普通版 + 全网版都装了）：不再启动第二份。两份各有自己的观察器，
  // 一份「临时显示」写回原文、另一份立刻又遮回去，还会有两个「防」按钮。谁先到谁负责，遮罩 #sff-cloak 按 id 共用、
  // 由先到的那份解除（这里不加 sff-ready）；两版脚本的存储各自独立，先到的那份在此站点停用时，让步的这份也不会接手
  const root = document.documentElement;
  if (root.dataset.sffActive) {
    console.info('[防剧透看球] 页面上已有另一份在防剧透，这份不再启动：', root.dataset.sffActive);
    return;
  }
  const controller: ShieldController = bootShield(document, settings, { siteMode });
  // 只有真的在遮挡时才占用页面：此站点停用 / 不在全网时段时让给同时装着的另一份
  const claim = () => {
    if (controller.active && !root.dataset.sffActive)
      root.dataset.sffActive = `userscript-${__SFF_VARIANT__}`;
  };
  claim();
  const isTop = window === window.top;

  // 临时显示/恢复也传给页面里的 iframe（播放器、评论区常放在 iframe 里，每个 frame 各跑一份脚本）
  const forward = (type: 'pause' | 'resume', ms?: number) => {
    for (let i = 0; i < window.frames.length; i++) {
      try {
        window.frames[i]!.postMessage({ source: FRAME_MSG, type, ms }, '*');
      } catch {
        /* 已经关掉的 frame */
      }
    }
  };
  const pauseAll = (ms: number) => {
    controller.pause(ms);
    forward('pause', ms);
  };
  const resumeAll = () => {
    controller.resume();
    forward('resume');
  };
  if (!isTop) {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window.parent && e.source !== unsafe?.parent) return;
      const d = e.data as { source?: string; type?: string; ms?: unknown } | null;
      if (d?.source !== FRAME_MSG) return;
      if (d.type === 'pause') {
        pauseAll(typeof d.ms === 'number' && d.ms > 0 ? Math.min(d.ms, MAX_PAUSE) : MAX_PAUSE);
      } else if (d.type === 'resume') resumeAll();
    });
  }
  /** 给面板和菜单用：暂停/恢复时连同 iframe 一起 */
  const withFrames = (): ShieldController => ({
    ...controller,
    pause: (ms = MAX_PAUSE) => pauseAll(ms),
    resume: resumeAll,
  });

  /**
   * 全网版：修改全网防剧透时段。没有站点规则的页面受时段影响，刷新一下让新设置生效
   * （视频网站按站点规则工作、不受影响，不刷新，免得打断播放）
   */
  const saveGlobal = async (patch: Partial<ShieldSettings['global']>) => {
    const cur = await load();
    settings = await save({ global: { ...cur.global, ...patch } });
    if (!siteMode) location.reload();
  };

  /** 当前域名在停用名单里（面板显示「在此站点启用」，手机上没有脚本菜单也能撤销） */
  const siteDisabled = () =>
    settings.disabledHosts.some((h) => hostDisabledBy(location.hostname, h));
  /** 已挂上的面板：设置在面板以外改了（其他标签页、脚本菜单）也要重画，按钮文字不能过时 */
  let panelRef: ReturnType<typeof mountPanel> | undefined;
  const enableSite = async () => {
    // 只去掉覆盖当前域名的停用项（和插件弹窗的「在此站点启用」一致）；按存储里最新的名单算
    const cur = await load();
    const list = cur.disabledHosts.filter((h) => !hostDisabledBy(location.hostname, h));
    settings = list.length === cur.disabledHosts.length ? cur : await save({ disabledHosts: list });
    controller.update(settings);
    ensureUi();
    panelRef?.refresh();
  };

  const activateUi = () => {
    const panel = mountPanel({
      controller: withFrames,
      currentMatch: () => currentMatchFor(settings, location.hostname),
      isWatched: (m) => watchedAfterKickoff(settings.watched[m.id], m.kickoff),
      webUrl: () => settings.dataBase.replace(/data\/?$/, '') || WEB_URL,
      globalWindow:
        __SFF_VARIANT__ === 'global'
          ? {
              get: () => settings.global,
              save: async (start, end) => {
                if (!isTimeValue(start) || !isTimeValue(end)) return '请填写开始和结束时间';
                await saveGlobal({ enabled: true, start, end });
                return siteMode ? '已保存，其他网站下次打开时生效' : '已保存';
              },
            }
          : undefined,
      disableSite: async () => {
        settings = await save((cur) => ({
          disabledHosts: [...cur.disabledHosts, location.hostname],
        }));
        controller.update(settings);
      },
      enableSite,
      siteDisabled,
      revealScore: async (m) => {
        settings = await save((cur) => ({
          watched: { ...cur.watched, [m.id]: Math.floor(Date.now() / 1000) },
        }));
        try {
          const { status, json } = await getJson(new URL(scorePath(m.id), settings.dataBase).href);
          const score = json as {
            id?: string;
            home?: number;
            away?: number;
            extraTime?: boolean;
            penalties?: [number, number];
          } | null;
          if (status === 200 && json === null) return `${NOT_SCORE_DATA}。已记为已看`;
          // 只有 404 是还没有比分；托管平台临时出错（5xx 等）要能再试一次（和插件一致）
          if (status === 404) return '数据源还没有这场的比分，已记为已看';
          if (status !== 200) return `比分加载失败：HTTP ${status}（已记为已看，可以再试一次）`;
          if (!score || score.id !== m.id || typeof score.home !== 'number') {
            return '数据源还没有这场的比分，已记为已看';
          }
          // 次回合、首回合还没看：不带加时/点球（能倒推出首回合比分）
          if (m.hideExtras) {
            return `${m.home.name} ${score.home} - ${score.away} ${m.away.name}（首回合还没看，加时和点球情况先不显示）`;
          }
          return `${m.home.name} ${score.home} - ${score.away} ${m.away.name}${
            score.penalties ? `（点球 ${score.penalties[0]} - ${score.penalties[1]}）` : ''
          }${score.extraTime ? '（经过加时）' : ''}`;
        } catch (err) {
          return `比分加载失败：${err instanceof Error ? err.message : '网络错误'}（已记为已看，可以再试一次）`;
        }
      },
    });
    panelRef = panel;
    registerMenu('防剧透：临时显示 5 分钟', () => {
      pauseAll(MAX_PAUSE);
      panel.refresh();
    });
    registerMenu('防剧透：恢复遮挡', () => {
      resumeAll();
      panel.refresh();
    });
    registerMenu('防剧透：在此站点停用', async () => {
      settings = await save((cur) => ({
        disabledHosts: [...cur.disabledHosts, location.hostname],
      }));
      controller.update(settings);
      panel.refresh();
    });
  };
  // 面板和菜单在遮挡启动后才挂：全网版可能在时段开始前就打开了页面，时段到了遮挡自动启动，这时也要有面板；
  // 此站点已停用时也挂（面板里可以重新启用）
  let uiMounted = false;
  const ensureUi = () => {
    claim();
    if (uiMounted || !isTop || !(controller.active || siteDisabled())) return;
    uiMounted = true;
    activateUi();
  };
  ensureUi();
  if (__SFF_VARIANT__ === 'global' && isTop && !uiMounted) setInterval(ensureUi, 60 * 1000);
  registerMenu('防剧透：在此站点重新启用', () => void enableSite());
  if (__SFF_VARIANT__ === 'global' && isTop) {
    const g = settings.global;
    const range = `${g.start}–${g.end}`;
    registerMenu(
      g.enabled ? `防剧透：关闭全网模式（当前 ${range}）` : '防剧透：开启全网模式',
      () => void saveGlobal({ enabled: !g.enabled }),
    );
    registerMenu('防剧透：设置全网时段', () => {
      const input = window.prompt(
        '全网防剧透时段，例如 06:00-12:00（00:00-00:00 表示全天）',
        `${settings.global.start}-${settings.global.end}`,
      );
      if (input == null) return;
      const t = parseTimeWindow(input);
      if (!t) {
        window.alert('格式不对，例如 06:00-12:00');
        return;
      }
      void saveGlobal({ enabled: true, ...t });
    });
  }
  onValueChange(KEY, (v) => {
    settings = normalizeSettings(v as Partial<ShieldSettings>, DEFAULT_DATA_BASE);
    controller.update(settings);
    // 其他标签页重新启用了此站点 / 打开了总开关：普通版没有补挂定时器，这里补挂面板和菜单
    ensureUi();
    panelRef?.refresh();
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
