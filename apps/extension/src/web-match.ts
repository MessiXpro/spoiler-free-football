/**
 * 浏览器 match pattern（如 "https://messixpro.github.io/spoiler-free-football/*"）是否覆盖 url。
 * 和浏览器一样忽略端口："http://localhost/*" 也覆盖 http://localhost:5173/。
 */
export function matchesPattern(url: string, pattern: string): boolean {
  if (pattern === '<all_urls>') return true;
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(pattern);
  if (!m) return false;
  const [, scheme = '', host = '', path = ''] = m;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const proto = u.protocol.slice(0, -1).toLowerCase();
  if (scheme === '*' ? proto !== 'http' && proto !== 'https' : proto !== scheme.toLowerCase())
    return false;
  const h = u.hostname.toLowerCase();
  const want = host.toLowerCase();
  if (want !== '*') {
    if (want.startsWith('*.')) {
      const base = want.slice(2);
      if (h !== base && !h.endsWith(`.${base}`)) return false;
    } else if (h !== want) return false;
  }
  const escaped = path
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(u.pathname + u.search);
}

/** 当前页面是不是防剧透网页本身（构建时的网页地址列表） */
export function isWebAppUrl(url: string, webMatches: readonly string[]): boolean {
  return webMatches.some((p) => matchesPattern(url, p));
}
