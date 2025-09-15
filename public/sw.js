const CACHE = 'wd-arts-cache-v1';
const OFFLINE_URL = '/';
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([OFFLINE_URL]);
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const fresh = await fetch(event.request);
      cache.put(event.request, fresh.clone());
      return fresh;
    } catch {
      return cache.match(OFFLINE_URL);
    }
  })());
});
