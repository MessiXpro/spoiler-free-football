import { useSyncExternalStore } from 'react';
import {
  defaultUserState,
  mergeUserState,
  prefsTime,
  sanitizeUserState,
  type CompetitionMode,
  type ScoreRecord,
  type Settings,
  type UserState,
} from '@sff/core';

const KEY = 'sff:state:v1';
const SCORES_KEY = 'sff:scores:v1';
/**
 * 本机"藏起比分并标记为没看"或清空过的已看记录：id → 时间（秒）。
 * 插件/用户脚本、同步码和同步服务器只会追加已看记录，没有这份记录的话，
 * 它们带回来的旧记录会把刚删掉的又加回来。
 */
const REMOVED_KEY = 'sff:unwatched:v1';

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

/** 从没保存过的状态：时间记为 0，导入同步码或从服务器合并时一定以对方为准 */
function fresh(): UserState {
  return { ...defaultUserState(0), prefsUpdatedAt: 0 };
}

function load(): UserState {
  const raw = safeGet(KEY);
  if (!raw) return fresh();
  try {
    const s = sanitizeUserState(JSON.parse(raw));
    // 旧版本没有单独记录订阅和设置的修改时间，用当时的 updatedAt 固定下来
    return { ...s, prefsUpdatedAt: prefsTime(s) };
  } catch {
    return fresh();
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

/** 订阅、赛事、设置的修改：另外记一个时间，合并时不会被只标记了已看的设备盖掉 */
function setPrefs(fn: (prev: UserState) => UserState) {
  setState((s) => ({ ...fn(s), prefsUpdatedAt: Date.now() }));
}

/** 本机删掉过的已看记录（见 REMOVED_KEY） */
export function removedWatched(): Record<string, number> {
  try {
    const raw = JSON.parse(safeGet(REMOVED_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        (e): e is [string, number] => typeof e[1] === 'number',
      ),
    );
  } catch {
    return {};
  }
}

function rememberRemoved(ids: string[]) {
  if (!ids.length) return;
  const t = Math.floor(Date.now() / 1000);
  // 只留最近 90 天的（数据本身只保留最近三周和未来一个月的比赛）
  const keepSince = t - 90 * 24 * 3600;
  const next = Object.fromEntries(
    Object.entries(removedWatched()).filter(([, at]) => at >= keepSince),
  );
  for (const id of ids) next[id] = t;
  safeSet(REMOVED_KEY, JSON.stringify(next));
}

/** 去掉本机删除之前就有的已看记录（删除之后在别处重新看过的照常保留） */
function dropRemoved(watched: Record<string, number>): Record<string, number> {
  const removed = removedWatched();
  return Object.fromEntries(
    Object.entries(watched).filter(([id, t]) => !(removed[id] !== undefined && t <= removed[id])),
  );
}

/** 合并外部状态（同步服务器）；已看记录取并集，订阅和设置以较新的一份为准 */
export function mergeState(incoming: UserState) {
  setState(mergeUserState(state, { ...incoming, watched: dropRemoved(incoming.watched) }));
}

/** 用户确认导入同步码：订阅、赛事和设置改用同步码里的，已看记录合并 */
export function importState(incoming: UserState) {
  const merged = mergeUserState(state, { ...incoming, watched: dropRemoved(incoming.watched) });
  setState({
    ...merged,
    teams: [...incoming.teams],
    competitions: { ...incoming.competitions },
    settings: { ...incoming.settings },
    prefsUpdatedAt: Date.now(),
  });
}

/** 只合并已看记录（来自插件/用户脚本） */
export function mergeWatched(watched: Record<string, number>) {
  const valid = Object.fromEntries(
    Object.entries(watched).filter(([, t]) => typeof t === 'number'),
  );
  const missing = Object.entries(dropRemoved(valid)).filter(([id]) => !state.watched[id]);
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
    rememberRemoved([id]);
    setState((s) => {
      const watched = { ...s.watched };
      delete watched[id];
      return { ...s, watched };
    });
  },
  unlock(key: string) {
    setState((s) => ({ ...s, unlocked: { ...s.unlocked, [key]: Math.floor(Date.now() / 1000) } }));
  },
  /** 撤销手动解锁（例如延期比赛的"标记为已看"） */
  relock(key: string) {
    setState((s) => {
      const unlocked = { ...s.unlocked };
      delete unlocked[key];
      return { ...s, unlocked };
    });
  },
  toggleTeam(id: string) {
    setPrefs((s) => ({
      ...s,
      teams: s.teams.includes(id) ? s.teams.filter((t) => t !== id) : [...s.teams, id],
    }));
  },
  setCompetitionMode(id: string, mode: CompetitionMode) {
    setPrefs((s) => {
      const competitions = { ...s.competitions };
      if (mode === 'teams') delete competitions[id];
      else competitions[id] = mode;
      return { ...s, competitions };
    });
  },
  updateSettings(patch: Partial<Settings>) {
    setPrefs((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  },
  reset() {
    // 记下清空前的已看记录，插件/脚本再发回来时不会恢复
    rememberRemoved(Object.keys(state.watched));
    // 清空后等于新设备：之后导入同步码或从服务器合并时以对方为准
    setState(fresh());
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
