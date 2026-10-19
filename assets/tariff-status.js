/* ══════════════════════════════════════════════════════════════
   TARIFF STATUS - one header chip for the encrypted tariff data
   ──────────────────────────────────────────────────────────────
   The three tariff loaders are the only code that knows WHY a dataset
   is not loaded, so they report a state per dataset here and this file
   turns those reports into the chip. The chip is static markup in
   anmerkung.html and is never created from JavaScript; every lookup is
   null-guarded, so a context without a document (tests) records states
   without rendering them.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* An unknown state coerces to 'error': a typo must read as a problem, never
     as healthy. */
  var STATES = ['pending', 'loading', 'ready', 'locked', 'insecure', 'unavailable', 'error', 'unwired', 'missing'];
  var BROKEN = { error: 1, unavailable: 1, unwired: 1, insecure: 1, missing: 1 };
  var IN_FLIGHT = { loading: 1, pending: 1 };
  var WORDS = { ready: 'loaded', locked: 'locked', loading: 'loading', pending: 'waiting',
    insecure: 'no https', unavailable: 'unavailable', error: 'failed',
    unwired: 'loaded, not used', missing: 'did not load' };
  var WHY = { 'wrong-passphrase': 'passphrase rejected', 'bad-artifact': 'artifact unreadable',
    'bundle-rejected': 'bundle code failed', 'bundle-empty': 'empty bundle',
    'engine-hook-missing': 'no engine hook', 'no-crypto': 'insecure origin' };
  var NAMES = { 'wackler-intl': 'Wackler international', 'wackler-national': 'Wackler national',
    honold: 'Honold', dachser: 'Dachser' };

  var reports = {};

  /* The declared datasets decide the denominator. Without the attribute, or
     without the chip, only what a loader reported is known. */
  function keys() {
    var doc = root.document;
    var chip = doc && typeof doc.getElementById === 'function' ? doc.getElementById('tariffStatus') : null;
    var attr = chip && typeof chip.getAttribute === 'function' ? chip.getAttribute('data-datasets') : '';
    var out = [], k;
    if (attr) String(attr).split(/\s+/).forEach(function (part) { if (part) out.push(part); });
    else for (k in reports) out.push(k);
    return out;
  }

  function stateOf(k) { return reports[k] ? reports[k].state : 'pending'; }

  /* Severity is problem > in-flight > healthy; a reason token never moves it. */
  function aggregate() {
    var ks = keys(), i, ready = 0;
    if (!ks.length) return 'pending';
    for (i = 0; i < ks.length; i++) if (BROKEN[stateOf(ks[i])]) return 'error';
    for (i = 0; i < ks.length; i++) if (IN_FLIGHT[stateOf(ks[i])]) return 'loading';
    for (i = 0; i < ks.length; i++) if (stateOf(ks[i]) === 'ready') ready++;
    if (ready === ks.length) return 'ready';
    return ready ? 'partial' : 'locked';
  }

  function label(agg) {
    var ks = keys(), i, ready = 0;
    if (agg === 'ready' || agg === 'partial') {
      for (i = 0; i < ks.length; i++) if (stateOf(ks[i]) === 'ready') ready++;
      return ready + '/' + ks.length;
    }
    if (agg === 'error') return 'problem';
    if (agg === 'loading') return 'loading…';
    return agg === 'locked' ? 'locked' : 'checking';
  }

  function describe() {
    var parts = [];
    keys().forEach(function (k) {
      var r = reports[k], state = r ? r.state : 'pending';
      parts.push((NAMES[k] || k) + ': ' + (WORDS[state] || state) +
        (r && r.detail ? ' (' + (WHY[r.detail] || r.detail) + ')' : ''));
    });
    return parts.join(' · ');
  }

  /* The chip is read-only, so the aggregate is a data attribute and the reason
     lives in text: the visible count and an sr-only sentence. */
  function render() {
    var doc = root.document;
    if (!doc || typeof doc.getElementById !== 'function') return;
    var agg = aggregate(), sentence = describe();
    var chip = doc.getElementById('tariffStatus');
    if (chip) { chip.setAttribute('data-state', agg); chip.title = sentence; }
    var value = doc.getElementById('tariffStatusValue');
    if (value) value.textContent = label(agg);
    var detail = doc.getElementById('tariffStatusDetail');
    if (detail) detail.textContent = sentence;
  }

  function set(key, state, detail) {
    if (!key) return;
    reports[key] = { state: STATES.indexOf(state) < 0 ? 'error' : state, detail: detail || '' };
    render();
  }

  /* A declared dataset whose loader never reported is a problem, not absent: it
     keeps its slot in the denominator. Idempotent. */
  function settle() {
    keys().forEach(function (k) {
      if (!reports[k] || reports[k].state === 'pending') reports[k] = { state: 'missing', detail: '' };
    });
    render();
  }

  function snapshot() {
    var copy = {}, k;
    for (k in reports) copy[k] = { state: reports[k].state, detail: reports[k].detail };
    return { keys: keys(), states: copy, aggregate: aggregate() };
  }

  root.TariffStatus = { set: set, settle: settle, snapshot: snapshot };
  if (root.addEventListener) root.addEventListener('load', settle);
})(typeof window !== 'undefined' ? window : globalThis);
