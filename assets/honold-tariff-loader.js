/* ══════════════════════════════════════════════════════════════
   HONOLD TARIFF LOADER - decrypts the OLD tariff client-side
   ──────────────────────────────────────────────────────────────
   The Honold OLD tariff matrix is business data and does not ship in
   the public repo. assets/honold-tariff.enc.json carries it as an
   AES-256-GCM ciphertext (built by scripts/encrypt-honold-tariff.mjs);
   this loader decrypts it with a team passphrase (asked once, kept in
   localStorage) and defines HONOLD_TARIFF on the page.
   The passphrase is shared with the Wackler and Dachser loaders, and the
   Rates card (assets/tariff-status.js) owns the single unlock control;
   this loader only reports the state of its dataset.

   Without the passphrase the engine runs normally - Honold rows are
   skipped, never blanked, because the note cannot be re-derived.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var LS_KEY = 'anmerkung_tariff_pass';
  var ENC_URL = 'assets/honold-tariff.enc.json';

  function b64ToBytes(s) {
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  /* {v,iter,salt,iv,data} + passphrase → plaintext JS. Throws on a wrong
     passphrase (AES-GCM authentication failure) - that is the only oracle. */
  async function decryptBundle(enc, passphrase) {
    var subtle = root.crypto.subtle;
    var keyMat = await subtle.importKey(
      'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    var key = await subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBytes(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
      keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var plain = await subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.data));
    return new TextDecoder().decode(plain);
  }

  root.HonoldTariffLoader = { decryptBundle: decryptBundle };

  /* Node test context: export the crypto core only, no DOM bootstrap. */
  if (typeof document === 'undefined') return;

  /* Status is cosmetic: a missing helper or a throwing setter must never break
     decryption, and these reports sit outside the existing try blocks. */
  function report(key, state, detail) {
    try {
      if (root.TariffStatus && typeof root.TariffStatus.set === 'function')
        root.TariffStatus.set(key, state, detail);
    } catch (e) { /* status is cosmetic; it must never break decryption */ }
  }

  async function boot() {
    var pass = null;
    try { pass = localStorage.getItem(LS_KEY); } catch (e) {}
    if (!pass) { report('honold', 'locked', ''); return; }
    /* An insecure origin has no crypto.subtle, so decryption cannot run. That is
       not a passphrase problem: keep the key and stay quiet. */
    if (!(root.crypto && root.crypto.subtle)) { report('honold', 'insecure', 'no-crypto'); return; }
    report('honold', 'loading', '');
    var enc;
    try {
      var res = await fetch(ENC_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      enc = await res.json();
    } catch (e) {
      /* Fetch, HTTP, or JSON-parse failure: the stored passphrase may still be
         valid, so keep it and stay quiet. A prompt cannot fix an unavailable
         artifact, and the engine runs with the tariff off (Honold rows
         skipped). */
      report('honold', 'unavailable', '');
      return;
    }
    var code;
    try {
      code = await decryptBundle(enc, pass);
    } catch (e) {
      /* Only a wrong passphrase fails the AES-GCM tag, which rejects with
         OperationError. Any other decrypt-path error (a malformed artifact, for
         instance) cannot be fixed by re-typing the passphrase, so keep the key
         and stay quiet. */
      if (e && e.name === 'OperationError') {
        try { localStorage.removeItem(LS_KEY); } catch (e2) {}
        report('honold', 'locked', 'wrong-passphrase');
      } else {
        report('honold', 'error', 'bad-artifact');
      }
      return;
    }
    try {
      (0, eval)(code); // the generated IIFE body targets globalThis
      if (typeof root.honoldTariffReady === 'function') root.honoldTariffReady();
    } catch (e) {
      /* Decrypt succeeded, so the passphrase is fine; a bad bundle is not a
         passphrase problem. Keep the key and stay quiet. */
      report('honold', 'error', 'bundle-rejected');
      return;
    }
    /* Same readiness predicate as honoldTariff() in the engine: the rule reads
       tiers, the zone rate arrays and the country -> zone codes that point at
       them, so empty containers are as unusable as a missing matrix
       (scripts/honold/build_tariff.py skips all-null zone columns, so a
       headers-only sheet decrypts to {tiers:[],zones:{},codes:{}}). Ready means
       at least one two-uppercase-letter country code names a zone whose rates
       cover every tier and include a rate. */
    var t = root.HONOLD_TARIFF;
    var isObj = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
    var ready = !!(t && Array.isArray(t.tiers) && t.tiers.length > 0 && isObj(t.zones) && isObj(t.codes)
      && Object.keys(t.codes).some(function (c) {
        return /^[A-Z]{2}$/.test(c) && Array.isArray(t.codes[c]) && t.codes[c].some(function (l) {
          return Array.isArray(t.zones[l]) && t.zones[l].length >= t.tiers.length
            && t.zones[l].some(function (r) { return r != null; });
        });
      }));
    if (ready) report('honold', 'ready', '');
    else report('honold', 'error', 'bundle-empty');
  }

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
