import { vi } from 'vitest';

type Listener = (...args: never[]) => unknown;
const event = () => {
  const listeners: Listener[] = [];
  return { listeners, addListener: (fn: Listener) => void listeners.push(fn) };
};

/**
 * 最小的 chrome.* 模拟：storage.local（含 onChanged）、runtime/alarms/permissions 事件、
 * scripting 的动态内容脚本（重复 id 注册会报错，和浏览器一样）。
 */
export function installChromeMock(initialSettings?: unknown) {
  const store: Record<string, unknown> = {};
  if (initialSettings !== undefined) store.settings = structuredClone(initialSettings);
  const onChanged: Array<(changes: Record<string, unknown>, area: string) => void> = [];
  const registered: chrome.scripting.RegisteredContentScript[] = [];
  const mock = {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) {
            const oldValue = store[k];
            store[k] = structuredClone(v);
            for (const fn of onChanged)
              fn({ [k]: { oldValue, newValue: structuredClone(v) } }, 'local');
          }
        },
      },
      onChanged: { addListener: (fn: (typeof onChanged)[number]) => void onChanged.push(fn) },
    },
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      sendMessage: vi.fn(async () => undefined),
    },
    alarms: { create: vi.fn(async () => undefined), onAlarm: event() },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
      onAdded: event(),
      onRemoved: event(),
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(async (filter?: { ids?: string[] }) =>
        structuredClone(registered.filter((s) => !filter?.ids || filter.ids.includes(s.id))),
      ),
      registerContentScripts: vi.fn(async (list: chrome.scripting.RegisteredContentScript[]) => {
        for (const s of list) {
          if (registered.some((r) => r.id === s.id))
            throw new Error(`Duplicate script ID '${s.id}'`);
          registered.push(structuredClone(s));
        }
      }),
      updateContentScripts: vi.fn(async (list: chrome.scripting.RegisteredContentScript[]) => {
        for (const s of list) {
          const i = registered.findIndex((r) => r.id === s.id);
          if (i < 0) throw new Error(`No script with ID '${s.id}'`);
          registered[i] = { ...registered[i]!, ...structuredClone(s) };
        }
      }),
      unregisterContentScripts: vi.fn(async (filter?: { ids?: string[] }) => {
        for (let i = registered.length - 1; i >= 0; i--) {
          if (!filter?.ids || filter.ids.includes(registered[i]!.id)) registered.splice(i, 1);
        }
      }),
    },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn() },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = mock;
  return { mock, store, registered };
}

export function removeChromeMock() {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
}

/** 等所有排队的 Promise 回调跑完 */
export const settle = () => new Promise((r) => setTimeout(r, 0));
