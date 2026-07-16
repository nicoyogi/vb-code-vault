/* The Alchemist \u2014 offline service worker (#21).

   Strategy (always-fresh by default):
     - Same-origin requests (everything we own — HTML, JS, CSS, JSON,
       manifest) → NETWORK-FIRST with cache fallback. The user always gets
       the latest deployed code when online; the cache is purely an offline
       safety net. No VERSION bumps required when content/rules change.
     - Cross-origin requests (CDN libs like XLSX, JSZip) → cache-first. These
       are big, immutable per URL, and don't change between deploys.
     - Navigation requests fall back to `./anmerkung.html` when the user is
       offline and lands on a URL we haven't cached yet.

   The cache name (and therefore implicit migration on upgrade) is still
   keyed off VERSION so SW logic changes can rotate the cache cleanly when
   needed. But VERSION no longer needs to bump for content updates.
*/
const VERSION = 'v1.7.5';
const CACHE = 'alchemist-' + VERSION;

/* Core assets to pre-cache on install so the very first offline visit works.
   Runtime caching takes over from there; with network-first for same-origin,
   these entries get refreshed naturally on every online load anyway. */
const CORE = [
  './anmerkung.html',
  './task-reviewer-siemens.html',
  './alokasi-project.html',
  './assets/grimoire-core.css',
  './assets/grimoire-core.js',
  './assets/anmerkung.css',
  './assets/anmerkung.js',
  './assets/wackler-ratecard-loader.js',
  './assets/wackler-ratecards.enc.json',
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

/* Helper: write a successful response into the runtime cache, fire-and-forget.
   `resp` must be cloned by the caller before it's consumed elsewhere. */
function cachePut(req, resp) {
  if (!resp || !resp.ok) return;
  const copy = resp.clone();
  caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = (url.origin === self.location.origin);
  const isNavigate = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  /* ── Same-origin → network-first ──
     Always try the network so the user gets the latest deployed code.
     On success, refresh the cached copy. On network failure, fall back to
     whatever we have cached; for navigations with no cached copy, fall back
     to the cached anmerkung.html shell so the app still boots offline. */
  if (sameOrigin) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' }).then(resp => {
        cachePut(req, resp);
        return resp;
      }).catch(() => caches.match(req).then(cached => {
        if (cached) return cached;
        if (isNavigate) return caches.match('./anmerkung.html');
        return undefined;
      }))
    );
    return;
  }

  /* ── Cross-origin (CDN libs etc.) → cache-first ──
     These URLs are immutable in practice (CDN-served libraries pinned by
     version), so cache-first is both faster and safe. */
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')) {
          cachePut(req, resp);
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
