/* ══════════════════════════════════════════════════════════════
   WACKLER RATECARD LOADER — decrypts the tariff data client-side
   ──────────────────────────────────────────────────────────────
   The Wackler rate matrices are business data and no longer ship in
   the public repo. assets/wackler-ratecards.enc.json carries them as
   an AES-256-GCM ciphertext (built by scripts/encrypt-ratecards.mjs);
   this loader decrypts it with a team passphrase (asked once, kept in
   localStorage) and defines WACKLER_RATECARD / WACKLER_NATIONAL_RATECARD
   on the page, then tells the engine via wacklerRatecardsReady().
   Without the passphrase the engine runs normally — Wackler costing
   simply stays off (its existing graceful no-op).
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var LS_KEY = 'wackler_rc_pass';
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

  function showUnlockButton() {
    if (document.getElementById('wacklerUnlockBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'wacklerUnlockBtn';
    btn.type = 'button';
    btn.textContent = '🔒 Wackler-Kosten entsperren';
    btn.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:999;padding:8px 14px;' +
      'border-radius:8px;border:1px solid #8884;background:#1b1b2add;color:#eee;cursor:pointer;font:inherit';
    btn.onclick = function () {
      var p = prompt('Wackler-Passwort:');
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
    try {
      var res = await fetch(ENC_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var code = await decryptBundle(await res.json(), pass);
      (0, eval)(code); // both ratecard IIFEs target globalThis, so this defines the two globals
      if (typeof root.wacklerRatecardsReady === 'function') root.wacklerRatecardsReady();
    } catch (e) {
      /* Wrong passphrase or fetch failure — the engine keeps running without
         Wackler costing; drop the bad passphrase and re-offer the lock. */
      try { localStorage.removeItem(LS_KEY); } catch (e2) {}
      showUnlockButton();
    }
  }

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
