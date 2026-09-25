// ChessMind Service Worker - Offline caching
const CACHE_NAME = 'chessmind-v19';
const ASSETS = [
  '/',
  '/css/app.css',
  '/css/chessground.base.css',
  '/css/chessground.brown.css',
  '/css/chessground.cburnett.css',
  '/js/app.js',
  '/js/analysis.js',
  '/js/sound.js',
  '/js/openings.js',
  '/js/fen-utils.js',
  '/js/move-parser.js',
  '/js/voice-controller.js',
  '/lib/chess.esm.js',
  '/lib/chessground.min.js',
  '/lib/stockfish/stockfish.wasm.js',
  '/lib/stockfish/stockfish.wasm',
  '/lib/stockfish/stockfish.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Caching app shell assets');
      for (const asset of ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Non-critical: Failed to pre-cache asset:', asset, err);
        }
      }
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
  const url = new URL(event.request.url);
  
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  if (url.origin === self.location.origin) {
    // Network-first with resilient cache fallback for same-origin assets
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const resClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, resClone);
            });
          }
          return response;
        })
        .catch(async () => {
          // 1. Try match with ignoreSearch (handles ?v=xx queries)
          let cached = await caches.match(event.request, { ignoreSearch: true });
          if (cached) return cached;

          // 2. Try match by pathname
          cached = await caches.match(url.pathname, { ignoreSearch: true });
          if (cached) return cached;

          // 3. Fallback to root for navigation requests
          if (event.request.mode === 'navigate') {
            const rootCached = await caches.match('/', { ignoreSearch: true });
            if (rootCached) return rootCached;
          }

          // 4. Safe fallback for CSS stylesheets rather than net::ERR_FAILED
          if (event.request.destination === 'style' || url.pathname.endsWith('.css')) {
            return new Response('/* Offline fallback */', {
              headers: { 'Content-Type': 'text/css' }
            });
          }

          return new Response('Offline resource unavailable', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        })
    );
  } else {
    // Cache-first for external CDN resources
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          return new Response('', { status: 408, statusText: 'Request timed out' });
        });
      })
    );
  }
});
