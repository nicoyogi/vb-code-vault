/* The Alchemist \u2014 offline service worker (#21).
   Strategy: network-first for the HTML shell (so updates are picked up on
   next load), cache-first for external scripts & fonts. Keeps the app fully
   functional offline once the first online visit has primed the caches.
*/
const VERSION = 'v1.1.0';
const CACHE = 'alchemist-' + VERSION;

/* Core assets to pre-cache on install. Keep the list short and let
   runtime caching handle the rest; unreachable URLs should not block install. */
const CORE = [
  './anmerkung.html',
  './assets/grimoire-core.css',
  './assets/grimoire-core.js',
  './manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(CORE.map(url =>
        fetch(url, { cache: 'no-cache' })
          .then(r => (r.ok ? cache.put(url, r) : null))
          .catch(() => null)
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  /* Network-first for HTML so a fresh version wins when online. */
  if (isHtml) {
    event.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match('./anmerkung.html')))
    );
    return;
  }

  /* Cache-first for everything else (static assets, CDN libs). */
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        /* Only cache successful, basic/cors responses. */
        if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
