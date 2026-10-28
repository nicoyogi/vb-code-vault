/* ══════════════════════════════════════════════════════════════
   WACKLER RATECARD LOADER — decrypts the tariff data client-side
   ──────────────────────────────────────────────────────────────
   The Wackler rate matrices are business data and no longer ship in
   the public repo. assets/wackler-ratecards.enc.json carries them as
   an AES-256-GCM ciphertext (built by scripts/encrypt-ratecards.mjs);
   this loader decrypts it with a team passphrase (asked once, kept in
   localStorage) and defines WACKLER_RATECARD / WACKLER_NATIONAL_RATECARD
   on the page, then tells the engine via wacklerRatecardsReady().
   The passphrase is shared with the Honold tariff loader, so one unlock
   control covers both.
   Without the passphrase the engine runs normally — Wackler costing
   simply stays off (its existing graceful no-op).
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var LS_KEY = 'anmerkung_tariff_pass';
  var LEGACY_KEY = 'wackler_rc_pass';
  var ENC_URL = 'assets/wackler-ratecards.enc.json';

  function b64ToBytes(s) {
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  /* {v,iter,salt,iv,data} + passphrase → plaintext JS. Throws on a wrong
     passphrase (AES-GCM authentication failure) — that is the only oracle. */
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

  root.WacklerRCLoader = { decryptBundle: decryptBundle };

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

  /* One bundle feeds two datasets, so every branch reports both. */
  function reportBoth(state, detail) {
    report('wackler-intl', state, detail);
    report('wackler-national', state, detail);
  }

  /* Decrypted, but can the engine actually use it? Only a truthy global AND a
     successful engine hook counts as loaded. */
  function bundleState(global, wired) {
    if (!global) return ['error', 'bundle-empty'];
    return wired ? ['ready', ''] : ['unwired', 'engine-hook-missing'];
  }

  function showUnlockButton() {
    if (document.getElementById('tariffUnlockBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'tariffUnlockBtn';
    btn.type = 'button';
    /* The lock is the affordance, so it stays in the label as a role marker rather
       than decoration; one control covers both datasets, which share a passphrase. */
    btn.textContent = '🔒 Unlock tariff data';
    btn.title = 'Enter the team passphrase to load the encrypted tariff data';
    btn.setAttribute('aria-label', 'Unlock tariff data with the team passphrase');
    /* Styling lives in anmerkung.css / anmerkung-pro.css, next to the rest of the
       page's controls. Building it here with inline cssText put this one control
       outside the design system: it kept its own radius and font under the pro
       skin and could not follow the theme. */
    btn.className = 'wackler-unlock-btn';
    btn.onclick = function () {
      var p = prompt('Tariff passphrase:');
      if (!p) return;
      try { localStorage.setItem(LS_KEY, p); } catch (e) {}
      location.reload();
    };
    /* The Rates card is where a user learns which datasets are locked, so the control
       belongs there; a page without that card keeps the floating fallback. */
    var row = document.getElementById('tariffActions');
    if (row && typeof row.insertBefore === 'function') row.insertBefore(btn, row.firstChild);
    else document.body.appendChild(btn);
  }

  async function boot() {
    var pass = null;
    try {
      pass = localStorage.getItem(LS_KEY);
      if (!pass) {
        /* Adopt the old Wackler-only key once, so existing users are not
           re-prompted for the passphrase the Honold loader now shares. */
        var legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          localStorage.setItem(LS_KEY, legacy);
          localStorage.removeItem(LEGACY_KEY);
          pass = legacy;
        }
      }
    } catch (e) {}
    if (!pass) { reportBoth('locked', ''); showUnlockButton(); return; }
    /* An insecure origin has no crypto.subtle, so decryption cannot run. That is
       not a passphrase problem: keep the key and stay quiet. */
    if (!(root.crypto && root.crypto.subtle)) { reportBoth('insecure', 'no-crypto'); return; }
    reportBoth('loading', '');
    var enc;
    try {
      var res = await fetch(ENC_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      enc = await res.json();
    } catch (e) {
      /* Fetch, HTTP, or JSON-parse failure: the stored passphrase may still be
         valid, so keep it and stay quiet. A prompt cannot fix an unavailable
         artifact, and the engine runs with Wackler costing off. */
      reportBoth('unavailable', '');
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
        reportBoth('locked', 'wrong-passphrase');
        showUnlockButton();
      } else {
        reportBoth('error', 'bad-artifact');
      }
      return;
    }
    var wired = false;
    try {
      (0, eval)(code); // both ratecard IIFEs target globalThis, so this defines the two globals
      if (typeof root.wacklerRatecardsReady === 'function') wired = root.wacklerRatecardsReady() === true;
    } catch (e) {
      /* Decrypt succeeded, so the passphrase is fine; a bad bundle is not a
         passphrase problem. Keep the key and stay quiet. */
      reportBoth('error', 'bundle-rejected');
      return;
    }
    var intl = bundleState(root.WACKLER_RATECARD, wired);
    var nat = bundleState(root.WACKLER_NATIONAL_RATECARD, wired);
    report('wackler-intl', intl[0], intl[1]);
    report('wackler-national', nat[0], nat[1]);
  }

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
