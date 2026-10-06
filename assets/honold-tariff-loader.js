/* ══════════════════════════════════════════════════════════════
   HONOLD TARIFF LOADER - decrypts the OLD tariff client-side
   ──────────────────────────────────────────────────────────────
   The Honold OLD tariff matrix is business data and does not ship in
   the public repo. assets/honold-tariff.enc.json carries it as an
   AES-256-GCM ciphertext (built by scripts/encrypt-honold-tariff.mjs);
   this loader decrypts it with a team passphrase (asked once, kept in
   localStorage) and defines HONOLD_TARIFF on the page.
   The passphrase is shared with the Wackler ratecard loader, so one unlock
   control covers both.

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

  function showUnlockButton() {
    /* Same single control as the Wackler loader. When both scripts ship,
       wackler-ratecard-loader.js runs first and this finds its button and
       returns; this copy is for a page that loads only the Honold loader. */
    if (document.getElementById('tariffUnlockBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'tariffUnlockBtn';
    btn.type = 'button';
    btn.textContent = '🔒 Unlock tariff data';
    btn.title = 'Enter the team passphrase to enable Wackler costing and Honold notes';
    btn.setAttribute('aria-label', 'Unlock tariff data with the team passphrase');
    btn.className = 'wackler-unlock-btn';
    btn.onclick = function () {
      var p = prompt('Tariff passphrase:');
      if (!p) return;
      try { localStorage.setItem(LS_KEY, p); } catch (e) {}
      location.reload();
    };
    document.body.appendChild(btn);
  }

  async function boot() {
    var pass = null;
    try { pass = localStorage.getItem(LS_KEY); } catch (e) {}
    if (!pass) { showUnlockButton(); return; }
    /* An insecure origin has no crypto.subtle, so decryption cannot run. That is
       not a passphrase problem: keep the key and stay quiet. */
    if (!(root.crypto && root.crypto.subtle)) return;
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
        showUnlockButton();
      }
      return;
    }
    try {
      (0, eval)(code); // the generated IIFE body targets globalThis
      if (typeof root.honoldTariffReady === 'function') root.honoldTariffReady();
    } catch (e) {
      /* Decrypt succeeded, so the passphrase is fine; a bad bundle is not a
         passphrase problem. Keep the key and stay quiet. */
      return;
    }
  }

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
