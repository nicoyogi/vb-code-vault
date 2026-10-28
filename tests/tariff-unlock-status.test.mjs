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
  /* The engine consumes all three parts (tiers, zones, country codes); a bundle
     with only tiers is not usable, see the tariffs-only test below. */
  'assets/honold-tariff.enc.json': await encryptBundle(
    'globalThis.HONOLD_TARIFF = { tiers: [50], zones: { "AT1 \u00d6sterreich": [10] }, ' +
    'codes: { AT: ["AT1 \u00d6sterreich"] } };', FAKE),
  'assets/dachser-ratecards.enc.json': await encryptBundle(
    'globalThis.DACHSER_RATECARDS = { ok: 1 };', FAKE),
};

function makeChip(declared) {
  const attrs = new Map();
  const listeners = {};
  if (declared) attrs.set('data-datasets', declared);
  return {
    id: 'tariffStatus',
    title: '',
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    click: () => listeners.click(),
  };
}

function makeDialog() {
  const listeners = {};
  return {
    open: false,
    shown: 0,
    closes: 0,
    showModal() { this.shown++; this.open = true; },
    close() { this.closes++; this.open = false; },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    emit: (type, event) => listeners[type](event),
  };
}

function makeActionsRow() {
  /* Close is the existing child, so an insert at firstChild proves the unlock
     control precedes it in the action row. */
  const closeStub = { textContent: 'Close' };
  const inserted = [];
  const row = { id: 'tariffActions', firstChild: closeStub };
  return { row, closeStub, inserted };
}

function makeContext(store, fetchImpl, opts = {}) {
  const appended = [];
  const byId = new Map();
  const actions = opts.tariffActions ? makeActionsRow() : null;
  if (actions) byId.set('tariffActions', actions.row);
  byId.set('tariffStatus', makeChip(DECLARED));
  byId.set('tariffStatusValue', { textContent: '' });
  byId.set('tariffStatusDetail', { textContent: '' });
  byId.set('dlgTariff', makeDialog());
  byId.set('tariffFoot', { hidden: true, textContent: '' });
  DECLARED.split(' ').forEach((k) => {
    const attrs = new Map();
    byId.set(`tariffRow-${k}`, {
      getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
      setAttribute: (name, value) => attrs.set(name, String(value)),
    });
    byId.set(`tariffRowState-${k}`, { textContent: '' });
    byId.set(`tariffRowWhy-${k}`, { textContent: '' });
  });
  /* A successful insertion puts the element in the document, so the second loader
     must find it by id and stay quiet instead of adding a second control. */
  if (actions) {
    actions.row.insertBefore = (el, ref) => {
      actions.inserted.push([el, ref]);
      if (el.id) byId.set(el.id, el);
    };
  }
  const document = {
    getElementById: (id) => byId.get(id) || null,
    createElement: () => {
      const el = {
        id: '', className: '', onclick: null, attrs: {},
        setAttribute: (k, v) => { el.attrs[k] = String(v); },
      };
      return el;
    },
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
  return { context, appended, byId, inserted: actions ? actions.inserted : [], row: actions && actions.row };
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
const rowState = (context, k) => context.document.getElementById(`tariffRow-${k}`).getAttribute('data-state');
const rowWord = (context, k) => context.document.getElementById(`tariffRowState-${k}`).textContent;
const foot = (context) => context.document.getElementById('tariffFoot');

test('unlock status: the dialog rows follow the real loaders', async () => {
  const wired = makeContext(new Map([[SHARED_KEY, FAKE]]));
  wired.context.wacklerRatecardsReady = () => true;
  load('tariff-status.js', wired.context);
  loadLoaders(wired.context);
  await until(() => snap(wired.context).aggregate === 'ready');

  assert.equal(rowState(wired.context, 'wackler-intl'), 'ready');
  assert.equal(rowWord(wired.context, 'wackler-intl'), 'loaded');
  assert.equal(rowState(wired.context, 'wackler-national'), 'ready');
  assert.equal(rowWord(wired.context, 'wackler-national'), 'loaded');
  assert.equal(rowWord(wired.context, 'honold'), 'loaded');
  assert.equal(foot(wired.context).hidden, true);

  const locked = makeContext(new Map());
  load('tariff-status.js', locked.context);
  loadLoaders(locked.context);
  await until(() => locked.appended.length === 1);

  DECLARED.split(' ').forEach((k) => {
    assert.equal(rowState(locked.context, k), 'locked');
    assert.equal(rowWord(locked.context, k), 'locked');
  });
  assert.equal(foot(locked.context).hidden, false);
  assert.match(foot(locked.context).textContent, /Unlock tariff data/);
});

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

test('unlock status: a Honold bundle the engine cannot consume is error/bundle-empty, never ready', async () => {
  /* The rule reads tiers, the zone rate arrays and the country -> zone codes that
     point at them, so a payload carrying only some of those - or empty containers,
     which scripts/honold/build_tariff.py produces from a headers-only sheet because
     it skips all-null zone columns - is one the engine cannot consume. The chip must
     say so instead of a green "loaded". */
  const unusable = {
    'tiers only': '{ tiers: [50] }',
    'empty containers': '{ tiers: [], zones: {}, codes: {} }',
    'no zone arrays and no codes': '{ tiers: [50, 100], zones: {}, codes: {} }',
    'codes with an empty zone list': '{ tiers: [50, 100], zones: { "X": [10, 20] }, codes: { AT: [] } }',
    'zone array shorter than tiers': '{ tiers: [50, 100, 500], ' +
      'zones: { "AT1 \\u00d6sterreich": [10, 20] }, codes: { AT: ["AT1 \\u00d6sterreich"] } }',
    /* A zone of nulls carries no rate, and a lower-case country key is one the
       engine never looks up, so neither may report ready. */
    'zone array with no rate': '{ tiers: [50, 100], ' +
      'zones: { "AT1 \\u00d6sterreich": [null, null] }, codes: { AT: ["AT1 \\u00d6sterreich"] } }',
    'lower-case country key': '{ tiers: [50, 100], ' +
      'zones: { "AT1 \\u00d6sterreich": [10, 20] }, codes: { at: ["AT1 \\u00d6sterreich"] } }',
  };
  const encrypted = {};
  for (const [name, literal] of Object.entries(unusable)) {
    encrypted[name] = await encryptBundle(`globalThis.HONOLD_TARIFF = ${literal};`, FAKE);
  }
  for (const [name, bundle] of Object.entries(encrypted)) {
    const store = new Map([[SHARED_KEY, FAKE]]);
    const bundles = { ...BUNDLES, 'assets/honold-tariff.enc.json': bundle };
    const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => bundles[url] });
    const { context } = makeContext(store, fetchImpl);
    load('tariff-status.js', context);
    loadLoaders(context);

    await until(() => snap(context).states.honold.state === 'error');

    const honold = snap(context).states.honold;
    assert.equal(honold.state, 'error', name);
    assert.equal(honold.detail, 'bundle-empty', name);
    assert.notEqual(honold.state, 'ready', name);
  }
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

test('unlock status: the unlock control lands in the Rates card action row', async () => {
  const { context, appended, inserted, row } = makeContext(new Map(), null, { tariffActions: true });
  loadLoaders(context);

  await until(() => inserted.length === 1);

  /* Both loaders run; the row branch must create the single shared control and
     leave the body append as a fallback only. */
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0][0].id, 'tariffUnlockBtn');
  assert.equal(inserted[0][0].textContent, '🔒 Unlock tariff data');
  assert.equal(inserted[0][0].title, 'Enter the team passphrase to load the encrypted tariff data');
  assert.equal(inserted[0][0].attrs['aria-label'], 'Unlock tariff data with the team passphrase');
  assert.equal(inserted[0][1], row.firstChild);
  assert.equal(appended.length, 0);
});

test('unlock status: a page without the Rates card keeps the floating fallback', async () => {
  const { context, appended, inserted } = makeContext(new Map());
  loadLoaders(context);

  await until(() => appended.length === 1);

  assert.equal(inserted.length, 0);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, 'tariffUnlockBtn');
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
