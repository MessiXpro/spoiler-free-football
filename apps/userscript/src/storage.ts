/**
 * 用户脚本存储：
 * - GM.getValue / GM.setValue（Violentmonkey、Tampermonkey 4+、iOS Userscripts，异步）
 * - GM_getValue / GM_setValue（旧版 Tampermonkey、Via 等，同步）
 * - 都没有时退回 localStorage（只在当前网站有效，无法和防剧透网页联动）
 * GM 存储对同一个脚本是跨网站共享的，所以网页和视频网站之间能同步"正在看哪一场"和"已看"。
 */
interface GmAsync {
  getValue?: (key: string, def?: unknown) => Promise<unknown>;
  setValue?: (key: string, value: unknown) => Promise<void>;
  xmlHttpRequest?: (details: GmXhrDetails) => void;
  addValueChangeListener?: (
    key: string,
    cb: (k: string, oldV: unknown, newV: unknown, remote: boolean) => void,
  ) => number;
}

export interface GmXhrDetails {
  method: 'GET';
  url: string;
  onload: (r: { status: number; responseText: string }) => void;
  onerror: (e: unknown) => void;
}

type G = typeof globalThis & {
  GM?: GmAsync;
  GM_getValue?: (key: string, def?: unknown) => unknown;
  GM_setValue?: (key: string, value: unknown) => void;
  GM_xmlhttpRequest?: (details: GmXhrDetails) => void;
  GM_addValueChangeListener?: GmAsync['addValueChangeListener'];
  GM_registerMenuCommand?: (name: string, fn: () => void) => unknown;
};

const g = globalThis as G;

export type StorageKind = 'gm' | 'gm-legacy' | 'local';

export function storageKind(): StorageKind {
  if (g.GM?.getValue && g.GM?.setValue) return 'gm';
  if (typeof g.GM_getValue === 'function' && typeof g.GM_setValue === 'function')
    return 'gm-legacy';
  return 'local';
}

const LOCAL_PREFIX = 'sff-userscript:';

export async function getValue<T>(key: string): Promise<T | undefined> {
  const kind = storageKind();
  try {
    if (kind === 'gm') return (await g.GM!.getValue!(key, undefined)) as T | undefined;
    if (kind === 'gm-legacy') return g.GM_getValue!(key, undefined) as T | undefined;
    const raw = window.localStorage.getItem(LOCAL_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function setValue(key: string, value: unknown): Promise<void> {
  const kind = storageKind();
  try {
    if (kind === 'gm') await g.GM!.setValue!(key, value);
    else if (kind === 'gm-legacy') g.GM_setValue!(key, value);
    else window.localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
  } catch {
    /* 存不了就算了 */
  }
}

/** 其他标签页修改了设置（支持时） */
export function onValueChange(key: string, cb: (value: unknown) => void) {
  const add = g.GM?.addValueChangeListener ?? g.GM_addValueChangeListener;
  if (typeof add === 'function') {
    add(key, (_k, _o, n, remote) => remote && cb(n));
  }
}

export function registerMenu(name: string, fn: () => void) {
  try {
    g.GM_registerMenuCommand?.(name, fn);
  } catch {
    /* 部分浏览器不支持菜单 */
  }
}

/** 跨域读取：优先 fetch（GitHub Pages 允许跨域），失败时用 GM_xmlhttpRequest */
export async function getJson(url: string): Promise<{ status: number; json: unknown }> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    const text = await res.text();
    return { status: res.status, json: safeParse(text) };
  } catch (err) {
    const xhr = g.GM?.xmlHttpRequest ?? g.GM_xmlhttpRequest;
    if (!xhr) throw err;
    return new Promise((resolve, reject) => {
      xhr({
        method: 'GET',
        url,
        onload: (r) => resolve({ status: r.status, json: safeParse(r.responseText) }),
        // 脚本管理器传给 onerror 的是响应对象而不是 Error：统一成 Error，提示里才有原因
        onerror: () => reject(new Error('网络错误')),
      });
    });
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
