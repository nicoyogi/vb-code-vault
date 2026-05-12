/* The Alchemist \u2014 offline service worker (#21).
   Strategy: network-first for the HTML shell (so updates are picked up on
   next load), cache-first for external scripts & fonts. Keeps the app fully
   functional offline once the first online visit has primed the caches.
*/
const VERSION = 'v1.4.3';
const CACHE = 'alchemist-' + VERSION;

/* Core assets to pre-cache on install. Keep the list short and let
   runtime caching handle the rest; unreachable URLs should not block install. */
const CORE = [
  './anmerkung.html',
  './task-reviewer-siemens.html',
  './assets/grimoire-core.css',
  './assets/grimoire-core.js',
  './assets/anmerkung-changelog.json',
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

/* ──────────────────────────────────────────────────────────
   Explicit precache on demand (wired to a "Download for Offline"
   button in the page). The page posts:
     { type: 'PRECACHE', urls: [...] }
   and we reply (via the MessageChannel port) with progress events:
     { type: 'PRECACHE_PROGRESS', done, total, url, ok }
     { type: 'PRECACHE_DONE',     done, total, failed: [urls] }
   Pages can also probe current status with { type: 'CACHE_STATUS', urls }
   which returns { type: 'CACHE_STATUS_RESULT', cached: [...], missing: [...] }.
   ────────────────────────────────────────────────────────── */
self.addEventListener('message', event => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  if (data.type === 'PRECACHE' && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const total = data.urls.length;
      let done = 0;
      const failed = [];
      for (const url of data.urls) {
        let ok = false;
        try {
          const resp = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
          if (resp && resp.ok) { await cache.put(url, resp.clone()); ok = true; }
        } catch (e) { /* swallow — reported via failed[] */ }
        done++;
        if (!ok) failed.push(url);
        if (port) port.postMessage({ type: 'PRECACHE_PROGRESS', done, total, url, ok });
      }
      if (port) port.postMessage({ type: 'PRECACHE_DONE', done, total, failed });
    })());
    return;
  }

  if (data.type === 'CACHE_STATUS' && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const cached = [];
      const missing = [];
      for (const url of data.urls) {
        const hit = await cache.match(url);
        (hit ? cached : missing).push(url);
      }
      if (port) port.postMessage({ type: 'CACHE_STATUS_RESULT', cached, missing });
    })());
    return;
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  /* Network-first for small JSON config files (e.g. anmerkung-changelog.json)
     so content edits surface on next load without waiting for a SW version bump.
     Falls back to the cached copy when offline. */
  const isChangelogJson = url.pathname.endsWith('/assets/anmerkung-changelog.json');

  if (isChangelogJson) {
    event.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

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
