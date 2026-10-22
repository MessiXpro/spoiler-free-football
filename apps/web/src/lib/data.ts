import { useCallback, useEffect, useState } from 'react';
import {
  scorePath,
  type DataMeta,
  type Program,
  type ProgramEpisode,
  type PublicMatch,
  type ScoreRecord,
} from '@sff/core';

export interface PlatformInfo {
  name: string;
  url: string;
  note?: string;
}

export interface BroadcastInfo {
  checkedAt: string;
  platforms: Record<string, PlatformInfo>;
  competitions: Record<
    string,
    {
      rights: Array<{
        platform: string;
        kinds: string[];
        vip?: boolean;
        confidence: string;
        url?: string;
        note?: string;
      }>;
    }
  >;
}

export interface AppData {
  matches: PublicMatch[];
  programs: Program[];
  episodes: ProgramEpisode[];
  meta: DataMeta | null;
  broadcast: BroadcastInfo | null;
}

export const dataUrl = (path: string) => new URL(`./data/${path}`, document.baseURI).href;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadData(): Promise<AppData> {
  // 注意：这里只加载不含比分的公开数据；比分在用户确认后才单独请求
  const [matches, programs, meta, broadcast] = await Promise.all([
    getJson<{ matches: PublicMatch[] }>('matches.json'),
    getJson<{ programs: Program[]; episodes: ProgramEpisode[] }>('programs.json').catch(() => ({
      programs: [],
      episodes: [],
    })),
    getJson<DataMeta>('meta.json').catch(() => null),
    getJson<BroadcastInfo>('broadcast.json').catch(() => null),
  ]);
  return {
    matches: matches.matches,
    programs: programs.programs,
    episodes: programs.episodes,
    meta,
    broadcast,
  };
}

export type DataState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: AppData; loadedAt: number };

/** 页面重新回到前台时，数据超过这么久就悄悄刷新一次（挂在主屏幕的 PWA 可能几天不重新打开） */
const REFRESH_AFTER_MS = 10 * 60 * 1000;

/** 把技术性的报错换成普通人看得懂的说明 */
export function describeDataError(message: string): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return '现在没有网络连接。联网后点「重试」。';
  }
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(message)) {
    return '连不上数据地址：可能是网络不通，或者网页地址打不开。';
  }
  if (/HTTP 404/.test(message)) {
    return '还没有数据文件。如果网页是刚刚部署的，等「数据更新与部署」跑完一次（大约 10 分钟）再试。';
  }
  if (/HTTP 5\d\d/.test(message)) return '服务器暂时出错，过一会儿再试。';
  if (/JSON|Unexpected token|Unexpected end/i.test(message)) {
    return '拿到的不是数据文件：可能是公共 Wi‑Fi 需要先登录，或者网络被劫持。';
  }
  return message;
}

export function useAppData(): DataState & { reload: () => void } {
  const [state, setState] = useState<DataState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    loadData()
      .then((data) => alive && setState({ status: 'ready', data, loadedAt: Date.now() }))
      .catch(
        (err: Error) =>
          alive &&
          // 刷新失败时保留已有的数据，不把正在看的页面换成报错
          setState((s) => (s.status === 'ready' ? s : { status: 'error', error: err.message })),
      );
    return () => {
      alive = false;
    };
  }, [attempt]);
  useEffect(() => {
    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      setState((s) => {
        if (s.status === 'ready' && Date.now() - s.loadedAt > REFRESH_AFTER_MS) reload();
        return s;
      });
    };
    const onOnline = () => setState((s) => (s.status === 'error' ? (reload(), s) : s));
    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh);
      window.removeEventListener('online', onOnline);
    };
  }, [reload]);
  return { ...state, reload };
}

/** 用户确认后才请求比分；没有这场的比分时返回 null */
export async function fetchScore(id: string): Promise<ScoreRecord | null> {
  const res = await fetch(dataUrl(scorePath(id)), { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // 有的静态服务器找不到文件时会返回首页 HTML，当作"没有比分"处理
  if (!(res.headers.get('content-type') ?? '').includes('json')) return null;
  try {
    const score = (await res.json()) as ScoreRecord;
    return score && typeof score.home === 'number' && score.id === id ? score : null;
  } catch {
    return null;
  }
}
