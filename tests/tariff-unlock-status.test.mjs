/*
 * The three tariff loaders report into assets/tariff-status.js, which renders
 * the header chip. These tests load the helper FIRST (the page's script order),
 * then all three loaders, into a node:vm context with a Map-backed localStorage,
 * a fetch over generated fake bundles, and a recording chip stub seeded in
 * document.getElementById.
 *
 * The passphrase and bundles are fake: encryptBundle is called with a throwaway
 * string. The real team passphrase and ciphertext never enter the repo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { encryptBundle } from '../scripts/encrypt-ratecards.mjs';

const FAKE = 'fake-team-passphrase-not-real';
const SHARED_KEY = 'anmerkung_tariff_pass';
const DECLARED = 'wackler-intl wackler-national honold dachser';

const BUNDLES = {
  'assets/wackler-ratecards.enc.json': await encryptBundle(
    'globalThis.WACKLER_RATECARD = { tiers: [50, 100] };\n' +
    'globalThis.WACKLER_NATIONAL_RATECARD = { tiers: [50] };', FAKE),
  'assets/honold-tariff.enc.json': await encryptBundle(
    'globalThis.HONOLD_TARIFF = { tiers: [50] };', FAKE),
  'assets/dachser-ratecards.enc.json': await encryptBundle(
    'globalThis.DACHSER_RATECARDS = { ok: 1 };', FAKE),
};

function makeChip(declared) {
  const attrs = new Map();
  if (declared) attrs.set('data-datasets', declared);
  return {
    id: 'tariffStatus',
    title: '',
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
  };
}

function makeContext(store, fetchImpl) {
  const appended = [];
  const byId = new Map();
  byId.set('tariffStatus', makeChip(DECLARED));
  byId.set('tariffStatusValue', { textContent: '' });
  byId.set('tariffStatusDetail', { textContent: '' });
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
    /* assets/dachser-ratecard-loader.js calls root.addEventListener unguarded. */
    addEventListener: () => {},
  });
  return { context, appended, byId };
}

function load(name, context) {
  const src = readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');
  vm.runInContext(src, context, { filename: name });
}

function loadLoaders(context) {
  load('wackler-ratecard-loader.js', context);
  load('honold-tariff-loader.js', context);
  load('dachser-ratecard-loader.js', context);
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

const snap = (context) => context.TariffStatus.snapshot();
const chipState = (context) => context.document.getElementById('tariffStatus').getAttribute('data-state');

test('unlock status: a valid passphrase loads all four datasets', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  const { context } = makeContext(store);
  let hookCalls = 0;
  context.wacklerRatecardsReady = () => { hookCalls++; return true; };
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => snap(context).aggregate === 'ready');

  const result = snap(context);
  assert.equal(result.states['wackler-intl'].state, 'ready');
  assert.equal(result.states['wackler-national'].state, 'ready');
  assert.equal(result.states.honold.state, 'ready');
  /* The fake set gives Dachser its own bundle, so the aggregate can be the
     honest 4/4 rather than a three-of-four partial. */
  assert.equal(result.states.dachser.state, 'ready');
  assert.equal(result.aggregate, 'ready');
  assert.equal(chipState(context), 'ready');
  assert.equal(hookCalls, 1);
});

test('unlock status: no passphrase locks every dataset behind the one button', async () => {
  const store = new Map();
  const { context, appended } = makeContext(store);
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => appended.length === 1);

  const result = snap(context);
  ['wackler-intl', 'wackler-national', 'honold', 'dachser']
    .forEach((k) => assert.equal(result.states[k].state, 'locked'));
  assert.equal(result.aggregate, 'locked');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, 'tariffUnlockBtn');
});

test('unlock status: a wrong passphrase is reported, and the key is dropped', async () => {
  const store = new Map([[SHARED_KEY, 'wrong-passphrase']]);
  const { context, appended } = makeContext(store);
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => !store.has(SHARED_KEY) && snap(context).aggregate === 'locked');

  const result = snap(context);
  assert.equal(result.states['wackler-intl'].state, 'locked');
  assert.equal(result.states['wackler-intl'].detail, 'wrong-passphrase');
  assert.equal(result.states['wackler-national'].detail, 'wrong-passphrase');
  assert.equal(result.states.honold.state, 'locked');
  assert.equal(result.states.honold.detail, 'wrong-passphrase');
  assert.equal(result.aggregate, 'locked');
  assert.equal(store.has(SHARED_KEY), false);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, 'tariffUnlockBtn');
});

test('unlock status: an unavailable artifact is reported and keeps the key', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  let calls = 0;
  const failingFetch = async () => { calls++; throw new Error('network down'); };
  const { context, appended } = makeContext(store, failingFetch);
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => calls >= 3
    && DECLARED.split(' ').every((k) => snap(context).states[k].state === 'unavailable'));

  const result = snap(context);
  ['wackler-intl', 'wackler-national', 'honold', 'dachser']
    .forEach((k) => assert.equal(result.states[k].state, 'unavailable'));
  /* An artifact nobody can fetch is a problem the chip has to say out loud, not a
     quiet "locked": the stored passphrase is still valid. */
  assert.equal(result.aggregate, 'error');
  assert.equal(chipState(context), 'error');
  assert.equal(store.get(SHARED_KEY), FAKE);
  assert.equal(appended.length, 0);
});

test('unlock status: a bundle that decrypts to no tariffs is empty, never ready', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  /* The ciphertext and the passphrase are both fine, but the plaintext defines no
     rate-card global at all, so the engine has nothing to consume. */
  const empty = {
    'assets/wackler-ratecards.enc.json': await encryptBundle('globalThis.__emptyWackler = 1;', FAKE),
    'assets/honold-tariff.enc.json': await encryptBundle('globalThis.__emptyHonold = 1;', FAKE),
    'assets/dachser-ratecards.enc.json': await encryptBundle('globalThis.__emptyDachser = 1;', FAKE),
  };
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => empty[url] });
  const { context } = makeContext(store, fetchImpl);
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => context.__emptyWackler && context.__emptyHonold && context.__emptyDachser);
  await until(() => snap(context).aggregate === 'error');

  const result = snap(context);
  ['wackler-intl', 'wackler-national', 'honold', 'dachser'].forEach((k) => {
    assert.equal(result.states[k].state, 'error');
    assert.equal(result.states[k].detail, 'bundle-empty');
  });
  assert.equal(result.aggregate, 'error');
  assert.notEqual(result.aggregate, 'ready');
});

test('unlock status: a malformed artifact is a bad artifact, not a bad passphrase', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  /* 200 with a valid JSON body that has no salt/iv/data, so decryption rejects
     with a base64 error, not the AES-GCM auth failure. */
  const malformedFetch = async () => ({ ok: true, status: 200, json: async () => ({ v: 1, iter: 310000 }) });
  const { context, appended } = makeContext(store, malformedFetch);
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => DECLARED.split(' ').every((k) => {
    const s = snap(context).states[k];
    return s.state === 'error' && s.detail === 'bad-artifact';
  }));

  const result = snap(context);
  ['wackler-intl', 'wackler-national', 'honold', 'dachser'].forEach((k) => {
    assert.equal(result.states[k].state, 'error');
    assert.equal(result.states[k].detail, 'bad-artifact');
  });
  assert.equal(store.get(SHARED_KEY), FAKE);
  assert.equal(appended.length, 0);
});

test('unlock status: a bundle whose code throws reports a rejected bundle', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  /* Mark before throwing, so the assertion proves the plaintext was decrypted
     and eval'd, not simply never reached. */
  const throwing = {
    'assets/wackler-ratecards.enc.json': await encryptBundle(
      'globalThis.__wacklerEvalReached = true; throw new Error("boom");', FAKE),
    'assets/honold-tariff.enc.json': await encryptBundle(
      'globalThis.__honoldEvalReached = true; throw new Error("boom");', FAKE),
    'assets/dachser-ratecards.enc.json': await encryptBundle(
      'globalThis.__dachserEvalReached = true; throw new Error("boom");', FAKE),
  };
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => throwing[url] });
  const { context } = makeContext(store, fetchImpl);
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => context.__wacklerEvalReached && context.__honoldEvalReached && context.__dachserEvalReached);
  await until(() => snap(context).aggregate === 'error');

  const result = snap(context);
  ['wackler-intl', 'wackler-national', 'honold', 'dachser'].forEach((k) => {
    assert.equal(result.states[k].state, 'error');
    assert.equal(result.states[k].detail, 'bundle-rejected');
  });
  assert.equal(context.__wacklerEvalReached, true);
  assert.equal(context.__honoldEvalReached, true);
  assert.equal(context.__dachserEvalReached, true);
});

test('unlock status: decrypted but no engine hook is unwired, never ready', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  const { context } = makeContext(store);
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => snap(context).states.honold.state === 'ready'
    && snap(context).states['wackler-intl'].state === 'unwired');

  const result = snap(context);
  assert.equal(result.states['wackler-intl'].state, 'unwired');
  assert.equal(result.states['wackler-national'].state, 'unwired');
  assert.equal(result.states['wackler-intl'].detail, 'engine-hook-missing');
  assert.equal(result.aggregate, 'error');
  assert.notEqual(result.aggregate, 'ready');
});

test('unlock status: a hook that returns false is unwired, never ready', async () => {
  const store = new Map([[SHARED_KEY, FAKE]]);
  const { context } = makeContext(store);
  /* The bundles decrypt and the globals load, but the engine says it cannot use
     them: only a true return from the hook counts as wired. */
  context.wacklerRatecardsReady = () => false;
  load('tariff-status.js', context);
  loadLoaders(context);

  await until(() => snap(context).states.honold.state === 'ready'
    && snap(context).states['wackler-intl'].state === 'unwired'
    && snap(context).states['wackler-national'].state === 'unwired');

  const result = snap(context);
  assert.equal(result.states['wackler-intl'].state, 'unwired');
  assert.equal(result.states['wackler-national'].state, 'unwired');
  assert.equal(result.states['wackler-intl'].detail, 'engine-hook-missing');
  assert.equal(result.states['wackler-national'].detail, 'engine-hook-missing');
  assert.equal(result.aggregate, 'error');
});

test('unlock status: without the helper the loaders behave exactly as before', async () => {
  /* No passphrase: the card cannot load, the single unlock button appears. */
  const locked = makeContext(new Map());
  loadLoaders(locked.context);
  await until(() => locked.appended.length === 1);
  assert.equal(locked.appended.length, 1);
  assert.equal(locked.appended[0].id, 'tariffUnlockBtn');
  assert.equal(locked.context.WACKLER_RATECARD, undefined);
  assert.equal(typeof locked.context.TariffStatus, 'undefined');

  /* With a passphrase: the card loads and no button is shown, still no throw. */
  const loaded = makeContext(new Map([[SHARED_KEY, FAKE]]));
  loadLoaders(loaded.context);
  await until(() => loaded.context.WACKLER_RATECARD && loaded.context.HONOLD_TARIFF);
  assert.equal(loaded.context.WACKLER_RATECARD.tiers.length, 2);
  assert.equal(loaded.appended.length, 0);
  assert.equal(typeof loaded.context.TariffStatus, 'undefined');
});
