/*
 * Round-trip tests for the Dachser ratecard encryption pair:
 * scripts/encrypt-dachser-ratecards.mjs (Node-side encrypt) and
 * assets/dachser-ratecard-loader.js (browser-side decrypt). The loader is a
 * classic script, so it's loaded here in a bare vm context with no `document`,
 * which makes it export its crypto core and skip the DOM bootstrap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { encryptBundle } from '../scripts/encrypt-dachser-ratecards.mjs';

function loadLoader() {
  const src = readFileSync(new URL('../assets/dachser-ratecard-loader.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, atob: globalThis.atob });
  vm.runInContext(src, ctx, { filename: 'dachser-ratecard-loader.js' });
  return ctx.DachserRCLoader;
}

test('dachser: encryptBundle → loader decryptBundle round-trip', async () => {
  const code = 'globalThis.DACHSER_RATECARDS = { schema: "dachser-ratecards/v1" };';
  const enc = await encryptBundle(code, 'team-secret');
  const loader = loadLoader();
  assert.equal(await loader.decryptBundle(enc, 'team-secret'), code);
});

test('dachser: wrong passphrase rejects (AES-GCM auth failure)', async () => {
  const enc = await encryptBundle('x', 'right-pass');
  const loader = loadLoader();
  await assert.rejects(loader.decryptBundle(enc, 'wrong-pass'));
});

test('dachser: the loader shares the team passphrase key with Wackler/Honold', () => {
  /* One unlock control covers all three bundles, so the storage key must match.
     Reading the loaders' sources is the cheapest way to pin that without a DOM. */
  const read = (p) => readFileSync(new URL(`../assets/${p}`, import.meta.url), 'utf8');
  const key = /var LS_KEY = '([^']+)'/;
  const dachser = read('dachser-ratecard-loader.js').match(key);
  const wackler = read('wackler-ratecard-loader.js').match(key);
  assert.ok(dachser && wackler, 'both loaders declare LS_KEY');
  assert.equal(dachser[1], wackler[1]);
  /* And the Dachser loader must not add a second unlock button. */
  assert.ok(!read('dachser-ratecard-loader.js').includes("createElement('button')"));
});
