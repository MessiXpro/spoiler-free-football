/* 防剧透看球 service worker（构建时由 vite.config.ts 填入版本号和预缓存列表） */
const VERSION = '__SFF_VERSION__';
const SHELL = `sff-shell-${VERSION}`;
const DATA = 'sff-data-v1';
const PRECACHE = __SFF_PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
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
