/*
 * The Wackler ratecard loader and the Honold tariff loader share one
 * passphrase under 'anmerkung_tariff_pass' and render one unlock button
 * (id 'tariffUnlockBtn'). These tests load both classic scripts into a
 * node:vm context that has a document, so the DOM bootstrap runs, with a
 * Map-backed localStorage and a fetch over generated fake bundles.
 *
 * The passphrase and bundles here are fake: encryptBundle is called with a
 * throwaway string. The real team passphrase and ciphertext never enter the
 * repo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { encryptBundle } from '../scripts/encrypt-ratecards.mjs';

const FAKE = 'fake-team-passphrase-not-real';
const SHARED_KEY = 'anmerkung_tariff_pass';
const LEGACY_KEY = 'wackler_rc_pass';

const BUNDLES = {
  'assets/wackler-ratecards.enc.json': await encryptBundle('globalThis.WACKLER_RATECARD = { ok: 1 };', FAKE),
  'assets/honold-tariff.enc.json': await encryptBundle('globalThis.HONOLD_TARIFF = { tiers: [50] };', FAKE),
};

function makeContext(store, fetchImpl) {
  const appended = [];
  const byId = new Map();
  const document = {
    getElementById: (id) => byId.get(id) || null,
    createElement: () => ({ id: '', className: '', onclick: null, setAttribute() {} }),
    body: {
      appendChild: (el) => {
        appended.push(el);
        if (el.id) byId.set(el.id, el);
      },
    },
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const fetch = fetchImpl || (async (url) => {
    const body = BUNDLES[url];
    return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404 };
  });
  const context = vm.createContext({
    crypto: globalThis.crypto,
    atob: globalThis.atob,
    TextEncoder,
    TextDecoder,
    fetch,
    localStorage,
    document,
    location: { reload() {} },
    prompt: () => null,
  });
  return { context, appended };
}

function load(name, context) {
  const src = readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');
  vm.runInContext(src, context, { filename: name });
}

/* PBKDF2 is ~150-200 ms per decrypt, so poll instead of sleeping a fixed time. */
async function until(check, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return check();
}

test('shared unlock: legacy wackler_rc_pass migrates and unlocks both bundles', async () => {
  const store = new Map([[LEGACY_KEY, FAKE]]);
  const { context, appended } = makeContext(store);
  load('wackler-ratecard-loader.js', context);
  load('honold-tariff-loader.js', context);

  await until(() => context.WACKLER_RATECARD && context.HONOLD_TARIFF);

  assert.equal(context.WACKLER_RATECARD.ok, 1);
  assert.deepEqual(Array.from(context.HONOLD_TARIFF.tiers), [50]);
  /* The migrated passphrase unlocks both, so neither loader shows the lock. */
  assert.equal(appended.length, 0);
  assert.equal(store.get(SHARED_KEY), FAKE);
  assert.equal(store.has(LEGACY_KEY), false);
});

test('shared unlock: no passphrase leaves both tariffs off behind one button', async () => {
  const store = new Map();
  const { context, appended } = makeContext(store);
  load('wackler-ratecard-loader.js', context);
  load('honold-tariff-loader.js', context);

  await until(() => appended.length > 0);

  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, 'tariffUnlockBtn');
  assert.equal(context.WACKLER_RATECARD, undefined);
  assert.equal(context.HONOLD_TARIFF, undefined);
});

test('shared unlock: wrong passphrase fails both, drops the key, shows the button', async () => {
  const store = new Map([[SHARED_KEY, 'wrong-passphrase']]);
  const { context, appended } = makeContext(store);
  load('wackler-ratecard-loader.js', context);
  load('honold-tariff-loader.js', context);

  /* The existing failure path removes the shared key and re-offers the lock. */
  await until(() => !store.has(SHARED_KEY));

  assert.equal(store.has(SHARED_KEY), false);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, 'tariffUnlockBtn');
  assert.equal(context.WACKLER_RATECARD, undefined);
  assert.equal(context.HONOLD_TARIFF, undefined);
});

test('shared unlock: a fetch failure keeps the stored passphrase and shows no button', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  let calls = 0;
  const failingFetch = async () => { calls++; throw new Error('network down'); };
  const { context, appended } = makeContext(store, failingFetch);
  load('wackler-ratecard-loader.js', context);
  load('honold-tariff-loader.js', context);

  /* Both loaders attempt the fetch; an unavailable artifact must not drop the
     shared passphrase or re-offer the lock. */
  await until(() => calls >= 2);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(store.get(SHARED_KEY), FAKE);
  assert.equal(appended.length, 0);
  assert.equal(context.WACKLER_RATECARD, undefined);
  assert.equal(context.HONOLD_TARIFF, undefined);
});

test('shared unlock: a malformed artifact keeps the key and shows no button', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  let fetches = 0;
  let bodies = 0;
  /* 200 with a valid JSON body that has no salt/iv/data, so decryption rejects
     with a base64 error, not the AES-GCM auth failure. */
  const malformedFetch = async () => {
    fetches++;
    return { ok: true, status: 200, json: async () => { bodies++; return { v: 1, iter: 310000 }; } };
  };
  const { context, appended } = makeContext(store, malformedFetch);
  load('wackler-ratecard-loader.js', context);
  load('honold-tariff-loader.js', context);

  /* Both loaders fetched and parsed the body, so the decrypt path was reached. */
  await until(() => fetches >= 2 && bodies >= 2);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(fetches, 2);
  assert.equal(bodies, 2);
  assert.equal(store.get(SHARED_KEY), FAKE);
  assert.equal(appended.length, 0);
  assert.equal(context.WACKLER_RATECARD, undefined);
  assert.equal(context.HONOLD_TARIFF, undefined);
});

test('shared unlock: a bundle whose code throws on eval keeps the key and shows no button', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  /* Mark before throwing, so the assertion proves the plaintext was decrypted
     and eval'd, not simply never reached. */
  const throwing = {
    'assets/wackler-ratecards.enc.json': await encryptBundle(
      'globalThis.__wacklerEvalReached = true; throw new Error("boom");', FAKE),
    'assets/honold-tariff.enc.json': await encryptBundle(
      'globalThis.__honoldEvalReached = true; throw new Error("boom");', FAKE),
  };
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => throwing[url] });
  const { context, appended } = makeContext(store, fetchImpl);
  load('wackler-ratecard-loader.js', context);
  load('honold-tariff-loader.js', context);

  await until(() => context.__wacklerEvalReached && context.__honoldEvalReached);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(context.__wacklerEvalReached, true);
  assert.equal(context.__honoldEvalReached, true);
  assert.equal(store.get(SHARED_KEY), FAKE);
  assert.equal(appended.length, 0);
  assert.equal(context.WACKLER_RATECARD, undefined);
  assert.equal(context.HONOLD_TARIFF, undefined);
});
