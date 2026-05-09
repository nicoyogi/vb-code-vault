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
