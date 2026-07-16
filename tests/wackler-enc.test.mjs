/*
 * Round-trip tests for the Wackler ratecard encryption pair:
 * scripts/encrypt-ratecards.mjs (Node-side encrypt) and
 * assets/wackler-ratecard-loader.js (browser-side decrypt). The loader is a
 * classic script, so it's loaded here in a bare vm context with no `document`,
 * which makes it export its crypto core and skip the DOM bootstrap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { encryptBundle } from '../scripts/encrypt-ratecards.mjs';

function loadLoader() {
  const src = readFileSync(new URL('../assets/wackler-ratecard-loader.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, atob: globalThis.atob });
  vm.runInContext(src, ctx, { filename: 'wackler-ratecard-loader.js' });
  return ctx.WacklerRCLoader;
}

test('encryptBundle → loader decryptBundle round-trip', async () => {
  const code = 'root.WACKLER_RATECARD = { tiers: [50, 100] };';
  const enc = await encryptBundle(code, 'team-secret');
  assert.equal(enc.v, 1);
  assert.equal(enc.iter, 310000);
  const loader = loadLoader();
  assert.equal(await loader.decryptBundle(enc, 'team-secret'), code);
});

test('wrong passphrase rejects (AES-GCM auth failure)', async () => {
  const enc = await encryptBundle('x', 'right-pass');
  const loader = loadLoader();
  await assert.rejects(loader.decryptBundle(enc, 'wrong-pass'));
});

test('each run uses a fresh salt and iv', async () => {
  const a = await encryptBundle('same', 'p');
  const b = await encryptBundle('same', 'p');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
});
