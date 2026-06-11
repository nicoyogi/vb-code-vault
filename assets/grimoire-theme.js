/* ──────────────────────────────────────────────────────────
   Grimoire Theme — shared motion layer (companion to
   grimoire-theme.css). Brings the index.html ambience to
   every page: aurora field, star/rune canvas, scroll reveal,
   mouse spotlight + 3D tilt, gold click sparks, scroll
   progress filament and a departure veil between pages.

   Pages opt in with <html data-grim="<page-id>"> and may set
   data-grim-cards="<selector>" to choose which elements get
   the reveal/spotlight/tilt treatment.

   Everything degrades gracefully: no JS → content fully
   visible; prefers-reduced-motion → static, no reveal hiding.
   ────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  if (!root.hasAttribute('data-grim')) return;

  var REDUCED = false;
  try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* noop */ }
  var FINE_POINTER = false;
  try { FINE_POINTER = window.matchMedia('(pointer: fine)').matches; } catch (e) { /* noop */ }

  var DEFAULT_CARDS = '.card,.qa-card,.person-card,.seal,.chronicle,.stat,.skeleton';
  var CARD_SEL = root.getAttribute('data-grim-cards') || DEFAULT_CARDS;

  function onReady(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ── Ambient layers ─────────────────────────────────────── */
  function injectLayers() {
    var frag = doc.createDocumentFragment();
    ['gr-aurora', 'gr-vignette', 'gr-grain'].forEach(function (cls) {
      if (doc.querySelector('.' + cls)) return;
      var el = doc.createElement('div');
      el.className = cls;
      el.setAttribute('aria-hidden', 'true');
      frag.appendChild(el);
    });
    doc.body.insertBefore(frag, doc.body.firstChild);
  }

  /* ── Aether canvas: twinkling stars + rising runes ───────
     Skipped when the page already runs its own bg canvas.   */
  function AetherEngine() {
    if (doc.querySelector('#bg, #bg-canvas, canvas.gr-aether')) return;
    var canvas = doc.createElement('canvas');
    canvas.className = 'gr-aether';
    canvas.setAttribute('aria-hidden', 'true');
    doc.body.insertBefore(canvas, doc.body.firstChild);

    var ctx = canvas.getContext('2d');
    var scale = (window.Grimoire && window.Grimoire.densityScale) ? (window.Grimoire.densityScale() || 0.4) : 0.7;
    if (REDUCED) scale = 0.4; /* one static, sparse frame */
    var CHARS = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ☽☿♄⊕⊗✦✧';
    var w, h, stars, runes, running = false, last = 0;

    function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
    function makeStar() {
      return {
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.1 + 0.3,
        a: Math.random() * 0.35 + 0.1,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.012 + 0.004
      };
    }
    function makeRune(initial) {
      return {
        ch: CHARS[Math.floor(Math.random() * CHARS.length)],
        x: Math.random() * w,
        y: initial ? Math.random() * h : h + 40,
        vy: -(Math.random() * 0.4 + 0.1),
        a: Math.random() * 0.1 + 0.05,
        phase: Math.random() * Math.PI * 2,
        size: Math.floor(Math.random() * 14) + 12
      };
    }
    function frame(dt) {
      ctx.clearRect(0, 0, w, h);
      var i, s, r, alpha;
      for (i = 0; i < stars.length; i++) {
        s = stars[i];
        s.phase += s.speed * dt * 16;
        alpha = (Math.sin(s.phase) * 0.5 + 0.5) * s.a;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(243,239,227,' + alpha + ')';
        ctx.fill();
      }
      for (i = 0; i < runes.length; i++) {
        r = runes[i];
        r.y += r.vy * dt; r.phase += 0.02 * dt;
        if (r.y < -40) {
          var fresh = makeRune(false);
          for (var k in fresh) r[k] = fresh[k];
        }
        alpha = (Math.sin(r.phase) * 0.5 + 0.5) * r.a;
        ctx.font = r.size + "px 'Cinzel', serif";
        ctx.fillStyle = 'rgba(216,181,110,' + alpha + ')';
        ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(216,181,110,' + (alpha * 0.5) + ')';
        ctx.fillText(r.ch, r.x, r.y);
        ctx.shadowBlur = 0;
      }
    }
    function loop(ts) {
      if (!running) return;
      var dt = Math.min((ts - last) / 16.67, 2.5);
      last = ts;
      frame(dt);
      if (!doc.hidden) requestAnimationFrame(loop); else running = false;
    }
    function start() {
      if (running) return;
      running = true; last = performance.now();
      requestAnimationFrame(loop);
    }

    resize();
    stars = []; runes = [];
    for (var i = 0; i < Math.round(80 * scale); i++) stars.push(makeStar());
    for (var j = 0; j < Math.round(30 * scale); j++) runes.push(makeRune(true));

    window.addEventListener('resize', function () { resize(); if (REDUCED) frame(0); });
    doc.addEventListener('visibilitychange', function () {
      if (REDUCED) return;
      if (doc.hidden) running = false; else start();
    });
    if (REDUCED) frame(0); else start();
  }

  /* ── Scroll progress filament ────────────────────────────── */
  function mountProgress() {
    var bar = doc.createElement('div');
    bar.className = 'gr-progress';
    bar.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(bar);
    var ticking = false;
    function update() {
      ticking = false;
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = max > 0 ? (Math.min(1, window.scrollY / max) * 100) + '%' : '0%';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ── Scroll reveal (IntersectionObserver + MutationObserver) ── */
  function mountReveal() {
    if (REDUCED || !('IntersectionObserver' in window)) return;
    var batch = 0;
    var io = new IntersectionObserver(function (entries) {
      var n = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.style.setProperty('--gr-stagger', (n % 6) * 0.055 + 's');
        n++;
        el.classList.add('gr-in');
        io.unobserve(el);
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });

    function prep(el) {
      if (el.__grR) return;
      el.__grR = true;
      el.classList.add('gr-r');
      io.observe(el);
    }
    function scan(scope) {
      var nodes;
      try { nodes = scope.querySelectorAll(CARD_SEL); } catch (e) { return; }
      for (var i = 0; i < nodes.length; i++) prep(nodes[i]);
    }
    scan(doc);

    var pending = null;
    var mo = new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; scan(doc); }, 80);
    });
    mo.observe(doc.body, { childList: true, subtree: true });

    /* Safety net: never leave content hidden */
    setTimeout(function () {
      var hidden = doc.querySelectorAll('.gr-r:not(.gr-in)');
      for (var i = 0; i < hidden.length; i++) {
        var r = hidden[i].getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) hidden[i].classList.add('gr-in');
      }
    }, 3000);
  }

  /* ── Spotlight + 3D tilt (event delegation, fine pointers) ── */
  function mountEnchant() {
    if (!FINE_POINTER) return;
    var TABLE_TAGS = { TR: 1, TD: 1, TH: 1, TBODY: 1, THEAD: 1, TABLE: 1 };
    var lit = null;

    function release(el) {
      if (!el) return;
      el.classList.remove('gr-lit');
      el.style.transform = '';
    }
    doc.addEventListener('pointermove', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(CARD_SEL) : null;
      if (el !== lit) { release(lit); lit = el; }
      if (!el || TABLE_TAGS[el.tagName]) return;

      if (!el.classList.contains('gr-lit')) {
        el.classList.add('gr-lit', 'gr-spot-host');
        if (!el.querySelector(':scope > .gr-glow')) {
          var glow = doc.createElement('span');
          glow.className = 'gr-glow';
          glow.setAttribute('aria-hidden', 'true');
          el.appendChild(glow);
        }
      }
      var r = el.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      el.style.setProperty('--mx', x + 'px');
      el.style.setProperty('--my', y + 'px');

      /* Tilt only sensible, card-sized elements */
      if (!REDUCED && r.width < 760 && r.height < 560 && r.width > 80) {
        var ry = ((x / r.width) - 0.5) * 5;
        var rx = (0.5 - (y / r.height)) * 5;
        el.style.transform = 'perspective(1100px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-3px)';
      }
    }, { passive: true });

    doc.addEventListener('pointerout', function (e) {
      if (!lit) return;
      var to = e.relatedTarget;
      if (!to || !lit.contains(to)) { release(lit); lit = null; }
    }, { passive: true });
  }

  /* ── Gold dust burst on click ────────────────────────────── */
  function mountSparks() {
    if (REDUCED || !FINE_POINTER || !('animate' in Element.prototype)) return;
    doc.addEventListener('click', function (e) {
      var t = e.target && e.target.closest
        ? e.target.closest('button, a, [role="button"], input[type="submit"]')
        : null;
      if (!t) return;
      var n = 7;
      for (var i = 0; i < n; i++) {
        var p = doc.createElement('span');
        p.className = 'gr-spark';
        p.style.left = (e.clientX - 2) + 'px';
        p.style.top = (e.clientY - 2) + 'px';
        doc.body.appendChild(p);
        var ang = (Math.PI * 2 * i) / n + Math.random() * 0.7;
        var dist = 24 + Math.random() * 30;
        var anim = p.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 0.95 },
          { transform: 'translate(' + (Math.cos(ang) * dist) + 'px,' + (Math.sin(ang) * dist - 8) + 'px) scale(0.15)', opacity: 0 }
        ], { duration: 480 + Math.random() * 220, easing: 'cubic-bezier(0.2,0.8,0.2,1)' });
        anim.onfinish = (function (node) { return function () { node.remove(); }; })(p);
      }
    }, { passive: true });
  }

  /* ── Departure veil between Grimoire pages ───────────────── */
  function mountVeil() {
    var veil = doc.createElement('div');
    veil.className = 'gr-veil';
    veil.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(veil);

    /* bfcache restore: make sure the veil is lifted */
    window.addEventListener('pageshow', function () { veil.classList.remove('on'); });
    if (REDUCED) return;

    doc.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target || a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^[a-z]+:/i.test(href) && a.origin !== location.origin) return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return; /* in-page anchor */
      e.preventDefault();
      veil.classList.add('on');
      setTimeout(function () { location.href = url.href; }, 230);
    });
  }

  onReady(function () {
    injectLayers();
    AetherEngine();
    mountProgress();
    mountReveal();
    mountEnchant();
    mountSparks();
    mountVeil();
  });
})();
