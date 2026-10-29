import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error 纯 JS 构建脚本
import { FALLBACK_JS, GUARD_JS } from '../guard.mjs';

/**
 * 构建时包在整个脚本外面的兼容性检查：旧浏览器（Safari ≤ 16.3、WebView < 98）缺少 RegExp 后行断言或
 * structuredClone，脚本会在最开头就抛错、什么都不做。包上以后改成在页面底部明确提示，而不是悄悄失效。
 */
const g = globalThis as unknown as { __ran?: number };
const run = () => {
  // 和构建产物一样：检查 + 脚本本体 + 兜底提示
  (0, eval)(`${GUARD_JS}(()=>{globalThis.__ran=1})();${FALLBACK_JS}`);
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete g.__ran;
  document.querySelectorAll('div[data-sff-ui]').forEach((d) => d.remove());
});

describe('旧浏览器兜底', () => {
  it('不支持 RegExp 后行断言（Safari ≤ 16.3）：脚本本体不运行，页面底部提示浏览器太旧', () => {
    const Native = RegExp;
    const shim = function (this: unknown, src: string | RegExp, flags?: string) {
      const s = src instanceof Native ? src.source : String(src);
      if (s.includes('(?<'))
        throw new SyntaxError('Invalid regular expression: invalid group specifier name');
      return new Native(src, flags);
    };
    // 替换期间 x instanceof RegExp 仍要成立
    shim.prototype = Native.prototype;
    vi.stubGlobal('RegExp', shim);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    run();
    expect(g.__ran).toBeUndefined();
    const notice = document.querySelector('div[data-sff-ui]');
    expect(notice?.textContent).toContain('浏览器版本太旧');
    expect(warn).toHaveBeenCalled();
  });

  it('缺少 String.prototype.at（WebView < 92）：同样提示', () => {
    const at = Object.getOwnPropertyDescriptor(String.prototype, 'at')!;
    delete (String.prototype as { at?: unknown }).at;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      run();
    } finally {
      Object.defineProperty(String.prototype, 'at', at);
    }
    expect(g.__ran).toBeUndefined();
    expect(document.querySelector('div[data-sff-ui]')?.textContent).toContain('浏览器版本太旧');
  });

  it('只缺 structuredClone（WebView 92–97）：脚本照常运行（脚本里已经不用它）', () => {
    vi.stubGlobal('structuredClone', undefined);
    run();
    expect(g.__ran).toBe(1);
    expect(document.querySelector('div[data-sff-ui]')).toBeNull();
  });

  it('正常浏览器：脚本本体照常运行，没有提示', () => {
    run();
    expect(g.__ran).toBe(1);
    expect(document.querySelector('div[data-sff-ui]')).toBeNull();
  });
});
