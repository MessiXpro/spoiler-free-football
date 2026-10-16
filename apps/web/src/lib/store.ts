import { useSyncExternalStore } from 'react';
import {
  defaultUserState,
  mergeUserState,
  sanitizeUserState,
  type CompetitionMode,
  type ScoreRecord,
  type Settings,
  type UserState,
} from '@sff/core';

const KEY = 'sff:state:v1';
const SCORES_KEY = 'sff:scores:v1';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式等情况下存不了，就只保留在内存里 */
  }
}

function load(): UserState {
  const raw = safeGet(KEY);
  if (!raw) return defaultUserState(Date.now());
  try {
    return sanitizeUserState(JSON.parse(raw));
  } catch {
    return defaultUserState(Date.now());
  }
}

let state: UserState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getState(): UserState {
  return state;
}

export function setState(next: UserState | ((prev: UserState) => UserState)) {
  const value = typeof next === 'function' ? next(state) : next;
  state = { ...value, updatedAt: Date.now() };
  safeSet(KEY, JSON.stringify(state));
  emit();
}

/** 合并外部状态（同步码、插件、同步服务器）；只合并不覆盖已看记录 */
export function mergeState(incoming: UserState) {
  setState(mergeUserState(state, incoming));
}

/** 只合并已看记录（来自插件/用户脚本） */
export function mergeWatched(watched: Record<string, number>) {
  const missing = Object.entries(watched).filter(
    ([id, t]) => typeof t === 'number' && !state.watched[id],
  );
  if (!missing.length) return;
  setState((s) => ({ ...s, watched: { ...s.watched, ...Object.fromEntries(missing) } }));
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUserState(): UserState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// 跨标签页同步
window.addEventListener('storage', (e) => {
  if (e.key === KEY && e.newValue) {
    try {
      state = sanitizeUserState(JSON.parse(e.newValue));
      emit();
    } catch {
      /* 忽略 */
    }
  }
});

export const actions = {
  markWatched(id: string) {
    setState((s) => ({ ...s, watched: { ...s.watched, [id]: Math.floor(Date.now() / 1000) } }));
  },
  unmarkWatched(id: string) {
    setState((s) => {
      const watched = { ...s.watched };
      delete watched[id];
      return { ...s, watched };
    });
  },
  unlock(key: string) {
    setState((s) => ({ ...s, unlocked: { ...s.unlocked, [key]: Math.floor(Date.now() / 1000) } }));
  },
  toggleTeam(id: string) {
    setState((s) => ({
      ...s,
      teams: s.teams.includes(id) ? s.teams.filter((t) => t !== id) : [...s.teams, id],
    }));
  },
  setCompetitionMode(id: string, mode: CompetitionMode) {
    setState((s) => {
      const competitions = { ...s.competitions };
      if (mode === 'teams') delete competitions[id];
      else competitions[id] = mode;
      return { ...s, competitions };
    });
  },
  updateSettings(patch: Partial<Settings>) {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  },
  reset() {
    setState(defaultUserState(Date.now()));
    safeSet(SCORES_KEY, '{}');
  },
};

/** 已显示过的比分缓存在本机，方便离线再看 */
export function cachedScore(id: string): ScoreRecord | null {
  try {
    const all = JSON.parse(safeGet(SCORES_KEY) ?? '{}') as Record<string, ScoreRecord>;
    return all[id] ?? null;
  } catch {
    return null;
  }
}

export function cacheScore(score: ScoreRecord) {
  try {
    const all = JSON.parse(safeGet(SCORES_KEY) ?? '{}') as Record<string, ScoreRecord>;
    all[score.id] = score;
    safeSet(SCORES_KEY, JSON.stringify(all));
  } catch {
    /* 忽略 */
  }
}
