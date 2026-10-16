import { neutralTitle, type PublicMatch } from '@sff/core';
import { dataUrl } from './data.ts';
import { getState, mergeWatched, subscribe } from './store.ts';

/**
 * 网页 ↔ 防剧透插件/用户脚本 的联动（window.postMessage）：
 * - 插件/脚本在页面最早期给 <html> 加 data-sff-shield="extension|userscript"，网页据此判断是否已安装
 * - 网页 → 插件：hello（带数据地址和已看记录）、open-match（即将跳转去看哪一场）、state（已看记录有变化）
 * - 插件 → 网页：watched（在插件里点了"显示比分"的比赛）
 */
export type ShieldKind = 'extension' | 'userscript';

export function detectShield(): ShieldKind | null {
  const v = document.documentElement.dataset.sffShield;
  return v === 'extension' || v === 'userscript' ? v : null;
}

const post = (msg: Record<string, unknown>) =>
  window.postMessage(
    { source: 'sff-web', ...msg },
    window.location.origin === 'null' ? '*' : window.location.origin,
  );

let started = false;

export function initBridge(): () => void {
  if (started) return () => {};
  started = true;
  const onMessage = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    const data = e.data as {
      source?: string;
      type?: string;
      watched?: Record<string, number>;
    } | null;
    if (data?.source !== 'sff-shield') return;
    if (data.type === 'watched' && data.watched && typeof data.watched === 'object') {
      mergeWatched(data.watched);
    }
  };
  window.addEventListener('message', onMessage);
  post({ type: 'hello', dataBase: dataUrl(''), watched: getState().watched });
  let last = JSON.stringify(getState().watched);
  const unsubscribe = subscribe(() => {
    const now = JSON.stringify(getState().watched);
    if (now !== last) {
      last = now;
      post({ type: 'state', watched: getState().watched });
    }
  });
  return () => {
    window.removeEventListener('message', onMessage);
    unsubscribe();
    started = false;
  };
}

/** 跳转到正版平台前告诉插件"要去看哪一场" */
export function notifyOpenMatch(match: PublicMatch, url: string, liveMode = false) {
  post({
    type: 'open-match',
    url,
    liveMode,
    match: {
      id: match.id,
      title: neutralTitle(match),
      competition: match.competition,
      kickoff: match.kickoff,
      home: match.home,
      away: match.away,
    },
  });
}
