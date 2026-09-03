// Retired service worker. The app is browser-only and no longer registers a
// worker, but browsers that installed an earlier version keep checking this
// URL. This kill switch clears every cache, unregisters itself, and reloads
// open pages so they are served from the network again. Keep this file in
// place; do not re-add registration or precaching.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map(client => client.navigate(client.url)));
  })());
});
