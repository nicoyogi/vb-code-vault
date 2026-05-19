/* The Alchemist \u2014 offline service worker (#21).
   Strategy:
     - Network-first for the HTML shell so updates are picked up on next load.
     - Network-first for `anmerkung-changelog.json` so content edits surface
       immediately. We piggyback on this fetch to auto-invalidate the static
       asset cache whenever the changelog `version` field changes — that way
       future rule/content updates only need a changelog version bump and the
       SW reliably re-fetches `anmerkung.js` & friends without a manual
       VERSION bump here. (See `reconcileChangelogVersion` below.)
     - Cache-first for everything else (static assets, CDN libs).
     Keeps the app fully functional offline once the first online visit has
     primed the caches.
*/
const VERSION = 'v1.7.0';
const CACHE = 'alchemist-' + VERSION;

/* Internal marker used to remember the last changelog `version` we observed.
   Stored as a regular cache entry under a path that will never collide with a
   real fetch. Lives in the same `CACHE` so it gets cleaned up alongside the
   rest when the cache is rotated on a SW VERSION bump. */
const VERSION_MARKER_URL = './__sw_changelog_version__';

/* Core assets to pre-cache on install. Keep the list short and let
   runtime caching handle the rest; unreachable URLs should not block install. */
const CORE = [
  './anmerkung.html',
  './task-reviewer-siemens.html',
  './assets/grimoire-core.css',
  './assets/grimoire-core.js',
  './assets/anmerkung.css',
  './assets/anmerkung.js',
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
   Auto-invalidation on changelog version bump.

   `anmerkung-changelog.json` is fetched network-first on every page load, so
   it gives us a free signal: when its top-level `version` field changes we
   purge the cached static assets (anmerkung.js / .css / .html / etc.) so the
   next request for each asset misses the cache, falls through to the network,
   and gets re-cached fresh. This means future rule/content updates only need
   a changelog version bump — the SW VERSION constant only needs to bump when
   the SW logic itself changes.

   First-time encounters (no marker stored yet) just record the version
   without purging — the assets we'd be purging were just freshly installed.
   ────────────────────────────────────────────────────────── */
async function getStoredChangelogVersion(cache) {
  try {
    const resp = await cache.match(VERSION_MARKER_URL);
    if (!resp) return null;
    return (await resp.text()) || null;
  } catch (e) {
    return null;
  }
}

async function setStoredChangelogVersion(cache, ver) {
  try {
    await cache.put(VERSION_MARKER_URL, new Response(ver, {
      headers: { 'Content-Type': 'text/plain' }
    }));
  } catch (e) { /* swallow — best-effort marker */ }
}

async function purgeStaleAssets(cache) {
  /* Drop every CORE entry except the changelog itself (we just refreshed it
     above) and obviously not the marker. Next request for each purged URL
     will miss the cache, fall through to network, and repopulate. */
  const toPurge = CORE.filter(url => !url.endsWith('/anmerkung-changelog.json'));
  await Promise.all(toPurge.map(url => cache.delete(url).catch(() => null)));
}

async function reconcileChangelogVersion(respForBody, cache) {
  try {
    const text = await respForBody.text();
    const data = JSON.parse(text);
    const newVer = data && data.version;
    if (!newVer) return;
    const stored = await getStoredChangelogVersion(cache);
    if (stored === null) {
      /* First boot under this SW — record the baseline so future bumps trigger
         a purge, but don't purge now (cache was just primed at install). */
      await setStoredChangelogVersion(cache, newVer);
      return;
    }
    if (stored !== newVer) {
      await purgeStaleAssets(cache);
      await setStoredChangelogVersion(cache, newVer);
    }
  } catch (e) { /* malformed JSON / fetch error — leave cache alone */ }
}

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
     Falls back to the cached copy when offline. Also drives the auto-purge
     guard via `reconcileChangelogVersion` — see top-of-file comment. */
  const isChangelogJson = url.pathname.endsWith('/assets/anmerkung-changelog.json');

  if (isChangelogJson) {
    event.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.ok) {
          /* One clone for the cache write, one for the version reconcile —
             a Response body is a stream and can only be consumed once. */
          const copyForCache = resp.clone();
          const copyForReconcile = resp.clone();
          caches.open(CACHE).then(async c => {
            await c.put(req, copyForCache);
            await reconcileChangelogVersion(copyForReconcile, c);
          }).catch(() => {});
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
