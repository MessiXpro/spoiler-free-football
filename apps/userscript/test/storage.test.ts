import { afterEach, describe, expect, it } from 'vitest';
import { getValue, setValue, storageKind } from '../src/storage.ts';

const g = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  delete g.GM;
  delete g.GM_getValue;
  delete g.GM_setValue;
  localStorage.clear();
});

describe('用户脚本存储', () => {
  it('没有 GM 接口时退回 localStorage', async () => {
    expect(storageKind()).toBe('local');
    await setValue('settings', { a: 1 });
    expect(await getValue('settings')).toEqual({ a: 1 });
    expect(localStorage.getItem('sff-userscript:settings')).toBe('{"a":1}');
  });

  it('优先使用异步 GM.getValue/GM.setValue', async () => {
    const map = new Map<string, unknown>();
    g.GM = {
      getValue: async (k: string, d?: unknown) => (map.has(k) ? map.get(k) : d),
      setValue: async (k: string, v: unknown) => void map.set(k, v),
    };
    expect(storageKind()).toBe('gm');
    await setValue('settings', { b: 2 });
    expect(map.get('settings')).toEqual({ b: 2 });
    expect(await getValue('settings')).toEqual({ b: 2 });
  });

  it('旧版同步 GM_getValue/GM_setValue', async () => {
    const map = new Map<string, unknown>();
    g.GM_getValue = (k: string, d?: unknown) => (map.has(k) ? map.get(k) : d);
    g.GM_setValue = (k: string, v: unknown) => void map.set(k, v);
    expect(storageKind()).toBe('gm-legacy');
    await setValue('x', 3);
    expect(await getValue('x')).toBe(3);
  });
});
