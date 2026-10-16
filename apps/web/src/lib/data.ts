import { useEffect, useState } from 'react';
import type { DataMeta, Program, ProgramEpisode, PublicMatch, ScoreRecord } from '@sff/core';

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
  { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: AppData };

export function useAppData(): DataState {
  const [state, setState] = useState<DataState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    loadData()
      .then((data) => alive && setState({ status: 'ready', data }))
      .catch((err: Error) => alive && setState({ status: 'error', error: err.message }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** 用户确认后才请求比分；没有这场的比分时返回 null */
export async function fetchScore(id: string): Promise<ScoreRecord | null> {
  const res = await fetch(dataUrl(`scores/${encodeURIComponent(id)}.json`), { cache: 'no-cache' });
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
