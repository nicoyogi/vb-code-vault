/* ──────────────────────────────────────────────────────────
   Grimoire — shared helpers for the decorative canvas.
   Usage on a page:

     (function(){
       if (!window.Grimoire.shouldAnimate('#bg')) {
         // Render a single static frame (the page still calls init())
         return { animate: false };
       }
       ...
     })();

   This file exposes a tiny API; each page keeps its own
   bespoke particle/rune logic to preserve its unique look.
   ────────────────────────────────────────────────────────── */
(function () {
  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* noop */ }

  // Density scale: 1.0 on desktop, 0.6 on tablet, 0.4 on phone, 0 when reduced motion
  function densityScale() {
    if (reducedMotion) return 0;
    var w = window.innerWidth || 1024;
    if (w < 560) return 0.4;
    if (w < 900) return 0.6;
    return 1.0;
  }

  // Visibility-aware requestAnimationFrame wrapper. Pauses when tab hidden.
  function visibleRAF(frame) {
    var running = true;
    function tick(ts) {
      if (!running) return;
      if (document.hidden) {
        // park — resume via visibilitychange
        return;
      }
      frame(ts);
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && running) {
        requestAnimationFrame(tick);
      }
    });
    requestAnimationFrame(tick);
    return function stop() { running = false; };
  }

  window.Grimoire = {
    reducedMotion: reducedMotion,
    densityScale: densityScale,
    visibleRAF: visibleRAF,
    // Convenience: should a canvas-driven animation run at all?
    shouldAnimate: function () { return !reducedMotion; }
  };
})();


/* ──────────────────────────────────────────────────────────
   Grimoire.Theme — shared light/dark toggle
   ----------------------------------------------------------
   Pages have two CSS conventions:
     • Default-dark pages opt in to light via `html.light`
       (todo.html, standard-wording.html)
     • Default-light pages opt in to dark via `html.dark`
       (qa-siemens.html)
   This module supports both without forcing a rewrite.

   Usage:
     var t = Grimoire.Theme.init({
       defaultMode: 'dark',              // this page's original default
       mode:        'light',              // the mode that triggers className
       className:   'light',              // the class toggled on <html>
       iconEl:  '#theme-icon',           // selector or Element
       labelEl: '#theme-label',          // selector or Element
       icons:  { light: '☀️', dark: '🌙' },
       labels: { light: 'Light', dark: 'Dark' },
       onChange: function(mode) { ... }  // optional
     });
     document.getElementById('btn').onclick = Grimoire.Theme.toggle;

   A single unified storage key (`grimoire_theme_v1`) is used
   across the whole site, so toggling on one page persists
   everywhere. Legacy per-page keys are migrated on first read.
   ────────────────────────────────────────────────────────── */
(function () {
  var UNIFIED_KEY = 'grimoire_theme_v1';
  var LEGACY_KEYS = ['grimoire-theme', 'sgp_wording_theme', 'sgp_kb_theme'];

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function safeSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* private mode, quota */ }
  }

  function migrateLegacy() {
    if (safeGet(UNIFIED_KEY)) return;
    for (var i = 0; i < LEGACY_KEYS.length; i++) {
      var v = safeGet(LEGACY_KEYS[i]);
      if (v === 'light' || v === 'dark') {
        safeSet(UNIFIED_KEY, v);
        return;
      }
    }
  }

  function getMode(fallback) {
    migrateLegacy();
    var v = safeGet(UNIFIED_KEY);
    return (v === 'light' || v === 'dark') ? v : (fallback || 'dark');
  }

  function setMode(mode) {
    if (mode !== 'light' && mode !== 'dark') return;
    safeSet(UNIFIED_KEY, mode);
    try {
      window.dispatchEvent(new CustomEvent('grimoire:theme', { detail: { mode: mode } }));
    } catch (e) { /* older browsers */ }
  }

  var controllers = [];

  function resolveEl(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') {
      try { return document.querySelector(ref); } catch (e) { return null; }
    }
    return ref;
  }

  function applyOne(ctrl, mode) {
    var opts = ctrl.opts;
    var html = document.documentElement;
    if (mode === opts.mode) html.classList.add(opts.className);
    else html.classList.remove(opts.className);

    // Lazy-resolve elements each apply — allows init before DOM ready
    var iconEl = resolveEl(opts.iconEl);
    var labelEl = resolveEl(opts.labelEl);
    var icons = opts.icons || {};
    var labels = opts.labels || {};
    if (iconEl && icons[mode] != null) iconEl.textContent = icons[mode];
    if (labelEl && labels[mode] != null) labelEl.textContent = labels[mode];

    if (typeof opts.onChange === 'function') {
      try { opts.onChange(mode); } catch (e) { /* isolate page errors */ }
    }
  }

  function applyAll(mode) {
    for (var i = 0; i < controllers.length; i++) applyOne(controllers[i], mode);
  }

  function init(opts) {
    opts = opts || {};
    if (!opts.className) opts.className = 'light';
    if (!opts.mode) opts.mode = 'light';
    if (!opts.defaultMode) opts.defaultMode = 'dark';

    var ctrl = { opts: opts };
    controllers.push(ctrl);

    var mode = getMode(opts.defaultMode);
    applyOne(ctrl, mode);
    return ctrl;
  }

  // Cross-tab sync: another tab flipping the theme updates this one
  window.addEventListener('storage', function (e) {
    if (e.key === UNIFIED_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
      applyAll(e.newValue);
    }
  });

  window.Grimoire = window.Grimoire || {};
  window.Grimoire.Theme = {
    init: init,
    get: getMode,
    set: function (mode) {
      setMode(mode);
      applyAll(mode);
    },
    toggle: function () {
      var cur = getMode('dark');
      var next = (cur === 'light') ? 'dark' : 'light';
      setMode(next);
      applyAll(next);
    },
    STORAGE_KEY: UNIFIED_KEY
  };
})();

/* ──────────────────────────────────────────────────────────
   Grimoire.Nav — single source of truth for cross-page links
   ----------------------------------------------------------
   Today every page hand-rolls its own footer link list,
   which drifts whenever a new page is added. This registry
   lets a footer be rendered from one source:

     document.getElementById('footer-links').innerHTML =
       Grimoire.Nav.footerLinks({ exclude: ['qa-siemens'] });

   Pages are free to keep their bespoke footers — the registry
   is opt-in.
   ────────────────────────────────────────────────────────── */
(function () {
  var pages = [
    { id: 'index',            href: 'index.html',            label: 'The Grimoire' },
    { id: 'code',             href: 'code.html',             label: 'The Vault' },
    { id: 'qa',               href: 'qa.html',               label: 'The Oracle' },
    { id: 'qa-siemens',       href: 'qa-siemens.html',       label: 'SGP Knowledge Base' },
    { id: 'anmerkung',        href: 'anmerkung.html',        label: 'The Alchemist' },
    { id: 'todo',             href: 'todo.html',             label: 'The Ledger' },
    { id: 'standard-wording', href: 'standard-wording.html', label: 'Standard Wording' },
    { id: 'alokasi-project',  href: 'alokasi-project.html',  label: 'Project Allocation' },
    { id: 'holiday-tracker',  href: 'holiday-tracker.html',  label: 'The Chronicle' }
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function footerLinks(opts) {
    opts = opts || {};
    var sep = opts.separator != null ? opts.separator : '&#10022;'; /* ✦ */
    var sepClass = opts.separatorClass || 'fsep';
    var exclude = opts.exclude || [];
    var include = opts.include || null;

    var list = pages.filter(function (p) {
      if (exclude.indexOf(p.id) !== -1) return false;
      if (include && include.indexOf(p.id) === -1) return false;
      return true;
    });

    return list.map(function (p) {
      return '<a href="' + esc(p.href) + '">' + esc(p.label) + '</a>';
    }).join('<span class="' + esc(sepClass) + '">' + sep + '</span>');
  }

  window.Grimoire = window.Grimoire || {};
  window.Grimoire.Nav = {
    pages: pages.slice(),
    get: function (id) {
      for (var i = 0; i < pages.length; i++) if (pages[i].id === id) return pages[i];
      return null;
    },
    footerLinks: footerLinks
  };
})();


/* ──────────────────────────────────────────────────────────
   Grimoire.Offline — Download-for-Offline helper
   ----------------------------------------------------------
   Lets any page:
     1) register the service worker, and
     2) wire a "Download for Offline" button that explicitly
        caches a list of URLs (all site pages + assets by default).

   Usage (simplest):
     Grimoire.Offline.register();            // on every page
     Grimoire.Offline.mount('#download-btn'); // on the page with the button

   Advanced:
     Grimoire.Offline.download({
       urls: ['index.html','code.html','…'],
       onProgress: ({done,total,url,ok}) => {…},
     }).then(({failed}) => {…});
   ────────────────────────────────────────────────────────── */
(function () {
  var SW_PATH = 'sw.js';

  // Default bundle to download for offline use: every page + shared assets.
  // Uses the Grimoire.Nav registry when present, so new pages are picked
  // up automatically as long as they are registered there.
  function defaultUrls() {
    var urls = ['./', './assets/grimoire-core.css', './assets/grimoire-core.js', './manifest.webmanifest'];
    try {
      var pages = (window.Grimoire && window.Grimoire.Nav && window.Grimoire.Nav.pages) || [];
      pages.forEach(function (p) {
        if (p && p.href) urls.push('./' + String(p.href).replace(/^\.?\//, ''));
      });
    } catch (e) { /* noop */ }
    // Dedup
    var seen = {}, out = [];
    for (var i = 0; i < urls.length; i++) {
      if (!seen[urls[i]]) { seen[urls[i]] = 1; out.push(urls[i]); }
    }
    return out;
  }

  function canRegister() {
    if (!('serviceWorker' in navigator)) return false;
    if (location.protocol === 'file:') return false;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return false;
    return true;
  }

  function register() {
    if (!canRegister()) return Promise.resolve(null);
    return navigator.serviceWorker.register(SW_PATH).catch(function () { return null; });
  }

  function activeWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.active || reg.installing || reg.waiting || null;
    }).catch(function () { return null; });
  }

  // Send a message with a MessageChannel and collect replies until `done`.
  function sendWithChannel(worker, msg, onMessage) {
    return new Promise(function (resolve, reject) {
      if (!worker) { reject(new Error('no-active-sw')); return; }
      var ch = new MessageChannel();
      ch.port1.onmessage = function (e) {
        var d = e.data || {};
        try { onMessage && onMessage(d); } catch (_) { /* isolate */ }
        if (d.type === 'PRECACHE_DONE' || d.type === 'CACHE_STATUS_RESULT') {
          resolve(d);
          ch.port1.close();
        }
      };
      worker.postMessage(msg, [ch.port2]);
    });
  }

  function download(opts) {
    opts = opts || {};
    var urls = opts.urls && opts.urls.length ? opts.urls.slice() : defaultUrls();
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    return register().then(activeWorker).then(function (worker) {
      if (!worker) {
        // No SW available (e.g. file://): degrade to simple fetches so that
        // at least HTTP cache gets primed. Progress still fires.
        var done = 0, total = urls.length, failed = [];
        var seq = Promise.resolve();
        urls.forEach(function (url) {
          seq = seq.then(function () {
            return fetch(url, { cache: 'reload' }).then(function (r) {
              var ok = !!(r && r.ok);
              if (!ok) failed.push(url);
              done++;
              if (onProgress) onProgress({ done: done, total: total, url: url, ok: ok });
            }).catch(function () {
              failed.push(url);
              done++;
              if (onProgress) onProgress({ done: done, total: total, url: url, ok: false });
            });
          });
        });
        return seq.then(function () { return { done: done, total: total, failed: failed }; });
      }
      return sendWithChannel(worker, { type: 'PRECACHE', urls: urls }, function (d) {
        if (d.type === 'PRECACHE_PROGRESS' && onProgress) {
          onProgress({ done: d.done, total: d.total, url: d.url, ok: d.ok });
        }
      });
    });
  }

  function status(urls) {
    urls = urls && urls.length ? urls.slice() : defaultUrls();
    return register().then(activeWorker).then(function (worker) {
      if (!worker) return { cached: [], missing: urls };
      return sendWithChannel(worker, { type: 'CACHE_STATUS', urls: urls });
    });
  }

  // Mount a button: manages its label, progress UI and disabled state.
  // Works with a bare <button>, or a button containing a nested
  // [data-offline-label] and [data-offline-progress] for richer styling.
  function mount(target, opts) {
    opts = opts || {};
    var btn = (typeof target === 'string') ? document.querySelector(target) : target;
    if (!btn) return null;

    var labelEl = btn.querySelector('[data-offline-label]') || btn;
    var progressEl = btn.querySelector('[data-offline-progress]');

    var IDLE    = opts.idleLabel    || 'Download for offline';
    var READY   = opts.readyLabel   || 'Available offline';
    var WORKING = opts.workingLabel || 'Downloading…';
    var FAIL    = opts.failLabel    || 'Retry offline download';

    function setLabel(txt) {
      if (labelEl === btn) btn.textContent = txt;
      else labelEl.textContent = txt;
    }
    function setProgress(txt) {
      if (progressEl) progressEl.textContent = txt || '';
    }

    function refresh() {
      status(opts.urls).then(function (s) {
        if (s && s.missing && s.missing.length === 0 && s.cached && s.cached.length > 0) {
          setLabel(READY);
          btn.dataset.offlineState = 'ready';
        } else {
          setLabel(IDLE);
          btn.dataset.offlineState = 'idle';
        }
        setProgress('');
      });
    }

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.dataset.offlineState = 'working';
      setLabel(WORKING);
      setProgress('0%');

      download({
        urls: opts.urls,
        onProgress: function (p) {
          var pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          setProgress(pct + '%');
        }
      }).then(function (res) {
        btn.disabled = false;
        if (res && res.failed && res.failed.length) {
          btn.dataset.offlineState = 'error';
          setLabel(FAIL);
          setProgress(res.failed.length + ' failed');
          if (typeof opts.onError === 'function') opts.onError(res.failed);
        } else {
          btn.dataset.offlineState = 'ready';
          setLabel(READY);
          setProgress('');
          if (typeof opts.onDone === 'function') opts.onDone(res);
        }
      }).catch(function () {
        btn.disabled = false;
        btn.dataset.offlineState = 'error';
        setLabel(FAIL);
      });
    });

    refresh();
    return { refresh: refresh, element: btn };
  }

  window.Grimoire = window.Grimoire || {};
  window.Grimoire.Offline = {
    register: register,
    download: download,
    status: status,
    mount: mount,
    defaultUrls: defaultUrls
  };
})();
