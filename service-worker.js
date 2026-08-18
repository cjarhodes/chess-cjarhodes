const CACHE_NAME = 'chess-coach-shell-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/growth.js',
  '/coach-config.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/vendor/jquery/jquery-3.6.0.min.js',
  '/vendor/chess.js/chess-0.10.3.min.js',
  '/vendor/chessboardjs/chessboard-1.0.0.min.css',
  '/vendor/chessboardjs/chessboard-1.0.0.min.js',
  '/stockfish/stockfish.js',
  '/stockfish/stockfish.wasm'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const refreshed = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || refreshed;
    })
  );
});
