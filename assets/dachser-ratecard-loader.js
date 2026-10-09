/* ══════════════════════════════════════════════════════════════
   DACHSER RATECARD LOADER — decrypts the tariff data client-side
   ──────────────────────────────────────────────────────────────
   The two Dachser rate matrices are business data and do not ship in
   the public repo. assets/dachser-ratecards.enc.json carries them as
   an AES-256-GCM ciphertext (built by
   scripts/encrypt-dachser-ratecards.mjs); this loader decrypts it and
   defines DACHSER_RATECARDS on the page, then tells the engine via
   dachserRatecardsReady().

   The passphrase is the same shared team key the Wackler and Honold
   loaders use ('anmerkung_tariff_pass'), so the single existing unlock
   control covers this too — this loader never adds a second button.
   Without the passphrase the engine runs normally and the Sonderfahrt /
   bisherigen notes simply stay off (a graceful no-op).
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var LS_KEY = 'anmerkung_tariff_pass';
  var ENC_URL = 'assets/dachser-ratecards.enc.json';

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

  root.DachserRCLoader = { decryptBundle: decryptBundle };

  /* Node test context: export the crypto core only, no DOM bootstrap. */
  if (typeof document === 'undefined') return;

  async function boot() {
    var pass = null;
    try { pass = localStorage.getItem(LS_KEY); } catch (e) {}
    /* No passphrase yet: the Wackler loader owns the single unlock button and
       will offer it. Re-running this later (after that unlock) picks the key up. */
    if (!pass) return;
    /* An insecure origin has no crypto.subtle, so decryption cannot run. That is
       not a passphrase problem: keep the key and stay quiet. */
    if (!(root.crypto && root.crypto.subtle)) return;
    var enc;
    try {
      var res = await fetch(ENC_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      enc = await res.json();
    } catch (e) {
      /* Artifact unavailable: the stored passphrase may still be valid. */
      return;
    }
    var code;
    try {
      code = await decryptBundle(enc, pass);
    } catch (e) {
      /* A wrong passphrase fails the AES-GCM tag (OperationError). Anything else
         is an artifact problem a re-typed passphrase cannot fix, so stay quiet
         and leave the shared key alone for the other loaders. */
      return;
    }
    try {
      (0, eval)(code); // the ratecard IIFE targets globalThis
      if (typeof root.dachserRatecardsReady === 'function') root.dachserRatecardsReady();
    } catch (e) {
      /* Decrypt succeeded, so the passphrase is fine; a bad bundle is not a
         passphrase problem. Keep the key and stay quiet. */
      return;
    }
  }

  /* The shared unlock control reloads the page, so a later script realm sees the
     stored key. Also listen for the same-tab unlock event when one is emitted. */
  root.addEventListener('storage', function (e) {
    if (e && e.key === LS_KEY) boot();
  });

  boot();
})(typeof window !== 'undefined' ? window : globalThis);