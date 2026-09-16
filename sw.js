// ChessMind Service Worker - Offline caching
const CACHE_NAME = 'chessmind-v9';
const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/analysis.js',
  '/js/board-setup.js',
  '/js/fen-utils.js',
  '/js/move-parser.js',
  '/js/voice-controller.js',
  '/js/settings.js',
  '/lib/chess.esm.js',
  '/lib/stockfish/wrapper.js',
  '/lib/stockfish/stockfish.js',
  '/lib/stockfish/stockfish.wasm',
  '/lib/stockfish/stockfish.worker.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Cache-first for same-origin assets, network-first for CDN resources
  const url = new URL(event.request.url);
  
  if (url.origin === self.location.origin) {
    // Network-first for local assets during development/frequent updates
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  } else {
    // Network-first for CDN (Chessground CSS/JS)
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
