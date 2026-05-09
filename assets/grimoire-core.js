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
