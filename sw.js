/* Idiom Tetris — Service Worker
 * ─────────────────────────────
 * Strategy
 *   • index.html       — stale-while-revalidate (returns cached immediately
 *                        for instant loads; updates in the background).
 *                        A `?v=<BUILD_ID>` suffix on the URL can be used
 *                        to force-bust the cache (see notes below).
 *   • static assets    — cache-first (idiom data, manifest, icons).
 *   • /api/* and cross-origin leaderboard calls — network-only.
 *
 * Versioning
 *   Bump CACHE_VERSION whenever you ship breaking changes to the cached
 *   asset list. The activate handler will purge the old cache and the
 *   fetch handler will lazy-populate the new one.
 *
 * Manual cache bust
 *   If a user reports stale assets, hit this in DevTools:
 *       navigator.serviceWorker.getRegistration().then(r => r.unregister())
 *   then reload. Or change index.html to /idiom-tetris/?v=2026-06-16
 *   and call caches.delete('idiom-tetris-v1') once.
 */

const CACHE_VERSION  = 'v1';
const STATIC_CACHE   = `idiom-tetris-static-${CACHE_VERSION}`;
const RUNTIME_CACHE  = `idiom-tetris-runtime-${CACHE_VERSION}`;

// Files to pre-cache on install so the game works fully offline
// after the first visit.
const PRECACHE_URLS = [
  './',
  './index.html',
  './idioms_compact.json',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './og-image.png',
  './audio/underground.ogg',
  './audio/pop1.ogg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't intercept the leaderboard worker or any cross-origin API
  if (url.origin !== self.location.origin) {
    return;  // default network behaviour
  }

  // index.html (with or without query): stale-while-revalidate
  if (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/idiom-tetris/') || url.pathname === '/idiom-tetris/' || url.pathname.endsWith('/idiom-tetris/index.html')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Everything else same-origin: cache-first with background revalidate
  event.respondWith(cacheFirst(req));
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) {
    // background revalidate (don't await)
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) cache.put(req, res.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Offline & not in cache — return a minimal fallback for navigation
    if (req.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}
