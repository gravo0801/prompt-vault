const CACHE_NAME = 'prompt-vault-v8';
const ASSETS = ['./', './sync-core.js?v=20261117', './manifest.json', './icon-192.svg', './icon-512.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('prompt-vault-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache authenticated requests, API data, images from other sites, or writes.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname) || url.pathname.endsWith('/prompts.json')) return;
  event.respondWith(fetch(event.request, {cache:'no-store'}).then(response => {
    if (response.ok) { const copy=response.clone(); event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request,copy))); }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    return Response.error();
  }));
});
