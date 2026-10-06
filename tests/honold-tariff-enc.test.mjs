/*
 * Round-trip tests for the Honold tariff encryption pair:
 * scripts/encrypt-honold-tariff.mjs (Node-side encrypt) and
 * assets/honold-tariff-loader.js (browser-side decrypt). The loader is a
 * classic script, so it's loaded here in a bare vm context with no `document`,
 * which makes it export its crypto core and skip the DOM bootstrap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { encryptBundle } from '../scripts/encrypt-ratecards.mjs';

function loadLoader() {
  const src = readFileSync(new URL('../assets/honold-tariff-loader.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, atob: globalThis.atob });
  vm.runInContext(src, ctx, { filename: 'honold-tariff-loader.js' });
  return ctx.HonoldTariffLoader;
}

test('honold: encryptBundle → loader decryptBundle round-trip', async () => {
  const code = 'globalThis.HONOLD_TARIFF = { tiers: [50, 100] };';
  const enc = await encryptBundle(code, 'team-secret');
  const loader = loadLoader();
  assert.equal(await loader.decryptBundle(enc, 'team-secret'), code);
});

test('honold: wrong passphrase rejects (AES-GCM auth failure)', async () => {
  const enc = await encryptBundle('x', 'right-pass');
  const loader = loadLoader();
  await assert.rejects(loader.decryptBundle(enc, 'wrong-pass'));
});
