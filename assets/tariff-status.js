/* ══════════════════════════════════════════════════════════════
   TARIFF STATUS - one header chip for the encrypted tariff data
   ──────────────────────────────────────────────────────────────
   The three tariff loaders are the only code that knows WHY a dataset
   is not loaded, so they report a state per dataset here and this file
   turns those reports into the header chip and the tariff list dialog.
   The chip is a button that opens that list; both are static markup in
   anmerkung.html and never created from JavaScript, so every lookup is
   null-guarded and a context without a document (tests) records states
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
  var UNLOCK_HINT = 'Locked datasets stay off until they are unlocked. "Unlock tariff data" loads them with the team passphrase.';

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

  /* The dialog rows are static markup keyed by data-dataset, so the list can
     never drift from the declared denominator; this only fills them. */
  function renderRows(doc) {
    var blocked = false;
    keys().forEach(function (k) {
      var r = reports[k], state = r ? r.state : 'pending';
      if (state === 'locked' || (r && r.detail === 'wrong-passphrase')) blocked = true;
      var row = doc.getElementById('tariffRow-' + k);
      if (row && typeof row.setAttribute === 'function') row.setAttribute('data-state', state);
      var word = doc.getElementById('tariffRowState-' + k);
      if (word) word.textContent = WORDS[state] || state;
      var why = doc.getElementById('tariffRowWhy-' + k);
      if (why) why.textContent = r && r.detail ? (WHY[r.detail] || r.detail) : '';
    });
    var foot = doc.getElementById('tariffFoot');
    if (foot) { foot.hidden = !blocked; foot.textContent = blocked ? UNLOCK_HINT : ''; }
  }

  /* The aggregate is a data attribute and the reason lives in text: the visible
     count, an sr-only sentence, and the dialog rows. The short announcement sits
     outside the button, because ARIA children of a button are presentational. */
  function render() {
    var doc = root.document;
    if (!doc || typeof doc.getElementById !== 'function') return;
    var agg = aggregate(), sentence = describe(), shown = label(agg);
    var chip = doc.getElementById('tariffStatus');
    if (chip) { chip.setAttribute('data-state', agg); chip.title = sentence; }
    var value = doc.getElementById('tariffStatusValue');
    if (value) value.textContent = shown;
    var detail = doc.getElementById('tariffStatusDetail');
    if (detail) detail.textContent = sentence;
    var announce = doc.getElementById('tariffStatusAnnounce');
    if (announce) {
      /* The chip click renders before showModal(), and some screen readers repeat
         an identical string; only a changed line is a new announcement. */
      var spoken = 'Tariff data: ' + shown;
      if (announce.textContent !== spoken) announce.textContent = spoken;
    }
    renderRows(doc);
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

  /* The chip opens the list. Every element and method below is optional, so a
     stub element or a bare context stays inert instead of throwing. */
  function wire() {
    var doc = root.document;
    if (!doc || typeof doc.getElementById !== 'function') return;
    var chip = doc.getElementById('tariffStatus');
    if (!chip || typeof chip.addEventListener !== 'function') return;
    var dlg = doc.getElementById('dlgTariff');
    function expanded(on) {
      if (typeof chip.setAttribute === 'function') chip.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    chip.addEventListener('click', function () {
      render();
      if (dlg && typeof dlg.showModal === 'function' && !dlg.open) {
        dlg.showModal();
        expanded(true);
      }
    });
    if (!dlg || typeof dlg.addEventListener !== 'function') return;
    dlg.addEventListener('close', function () { expanded(false); });
    /* A click in the dialog's own padding, or in a gap between its blocks, targets
       the dialog element too, so only a point outside its box is a backdrop click. */
    dlg.addEventListener('click', function (e) {
      if (!e || e.target !== dlg || typeof dlg.close !== 'function') return;
      if (typeof dlg.getBoundingClientRect === 'function') {
        var r = dlg.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
      }
    });
  }

  root.TariffStatus = { set: set, settle: settle, snapshot: snapshot };
  wire();
  if (root.addEventListener) root.addEventListener('load', settle);
})(typeof window !== 'undefined' ? window : globalThis);
