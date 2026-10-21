/* 防剧透看球 service worker（构建时由 vite.config.ts 填入版本号和预缓存列表） */
const VERSION = '__SFF_VERSION__';
const SHELL = `sff-shell-${VERSION}`;
const DATA = 'sff-data-v1';
const PRECACHE = __SFF_PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // cache: 'reload'：绕过浏览器 HTTP 缓存（GitHub Pages 的 HTML 有 10 分钟缓存），
      // 否则新版本的缓存里可能存进旧的 index.html，指向已经被删掉的旧 JS，页面会一直白屏
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('sff-shell-') && k !== SHELL)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 更新前打开、还在运行旧版 JS 的页面会按比赛 id 请求 data/scores/<id>.json；
  // 换算成现在的文件名（比赛 id 的哈希，见 packages/core/src/match/score-file.ts），免得显示「没有比分」
  const legacy = /\/data\/scores\/([^/]+)\.json$/.exec(url.pathname);
  if (legacy && !/^[0-9a-f]{24}$/.test(legacy[1])) {
    event.respondWith(legacyScore(url, legacy[1]));
    return;
  }

  // 数据：网络优先，离线时用上次的缓存
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((hit) => hit || Response.error())),
    );
    return;
  }

  // 页面外壳：缓存优先
  event.respondWith(
    caches
      .match(event.request, { ignoreSearch: url.pathname.endsWith('/') })
      .then((hit) => hit || fetch(event.request)),
  );
});

async function legacyScore(url, encodedId) {
  let id;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return fetch(url.href);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sff-score:${id}`));
  const name = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
  return fetch(new URL(`${name}.json`, url).href, { cache: 'no-cache' }).catch(() =>
    Response.error(),
  );
}
