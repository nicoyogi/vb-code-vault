/*
 * assets/tariff-status.js is the read-only report the three tariff loaders
 * write into. The state machine is tested in a bare node:vm context (no
 * document, no addEventListener); the render path uses a recording chip stub
 * that stands in for the static markup in anmerkung.html.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../assets/tariff-status.js', import.meta.url), 'utf8');
const ALL = 'wackler-intl wackler-national honold dachser';

function load(globals) {
  const ctx = vm.createContext({ ...globals });
  vm.runInContext(SRC, ctx, { filename: 'tariff-status.js' });
  return ctx;
}

function makeChip(declared) {
  const attrs = new Map();
  if (declared) attrs.set('data-datasets', declared);
  return {
    title: '',
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
  };
}

function renderContext(declared) {
  const chip = makeChip(declared);
  const els = {
    tariffStatus: chip,
    tariffStatusValue: { textContent: '' },
    tariffStatusDetail: { textContent: '' },
  };
  const listeners = {};
  const ctx = load({
    document: { getElementById: (id) => els[id] || null },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  });
  return { ctx, ts: ctx.TariffStatus, chip, els, listeners };
}

test('no reports and no declared datasets -> pending', () => {
  const ts = load({}).TariffStatus;
  assert.equal(ts.snapshot().aggregate, 'pending');
  assert.deepEqual(Array.from(ts.snapshot().keys), []);
});

test('one ready of four declared -> loading', () => {
  const { ts, chip } = renderContext(ALL);
  ts.set('wackler-intl', 'ready', '');
  assert.equal(ts.snapshot().aggregate, 'loading');
  assert.equal(chip.getAttribute('data-state'), 'loading');
});

test('two ready and two locked -> partial, counted out of four', () => {
  const { ts, els } = renderContext(ALL);
  ts.set('wackler-intl', 'ready', '');
  ts.set('wackler-national', 'ready', '');
  ts.set('honold', 'locked', '');
  ts.set('dachser', 'locked', '');
  assert.equal(ts.snapshot().aggregate, 'partial');
  assert.equal(els.tariffStatusValue.textContent, '2/4');
});

test('four ready -> ready', () => {
  const { ts, els, chip } = renderContext(ALL);
  ['wackler-intl', 'wackler-national', 'honold', 'dachser']
    .forEach((k) => ts.set(k, 'ready', ''));
  assert.equal(ts.snapshot().aggregate, 'ready');
  assert.equal(els.tariffStatusValue.textContent, '4/4');
  assert.equal(chip.getAttribute('data-state'), 'ready');
});

test('four locked -> locked', () => {
  const { ts, els } = renderContext(ALL);
  ['wackler-intl', 'wackler-national', 'honold', 'dachser']
    .forEach((k) => ts.set(k, 'locked', ''));
  assert.equal(ts.snapshot().aggregate, 'locked');
  assert.equal(els.tariffStatusValue.textContent, 'locked');
});

test('any error -> problem, and the detail names the failing dataset', () => {
  const { ts, els } = renderContext(ALL);
  ['wackler-intl', 'wackler-national', 'honold'].forEach((k) => ts.set(k, 'ready', ''));
  ts.set('dachser', 'error', 'bundle-rejected');
  assert.equal(ts.snapshot().aggregate, 'error');
  assert.equal(els.tariffStatusValue.textContent, 'problem');
  assert.match(els.tariffStatusDetail.textContent, /Dachser: failed \(bundle code failed\)/);
});

test('a broken dataset outranks an in-flight one: ready + loading + unavailable is error', () => {
  const { ts } = renderContext('wackler-intl wackler-national honold');
  ts.set('wackler-intl', 'ready', '');
  ts.set('wackler-national', 'loading', '');
  ts.set('honold', 'unavailable', '');
  assert.equal(ts.snapshot().aggregate, 'error');
});

test('an unknown state coerces to error and moves the aggregate with it', () => {
  const { ts } = renderContext(ALL);
  ts.set('honold', 'bogus');
  assert.equal(ts.snapshot().states.honold.state, 'error');
  assert.equal(ts.snapshot().aggregate, 'error');
});

test('unwired is a problem, not a loaded dataset', () => {
  const { ts } = renderContext(ALL);
  ['wackler-intl', 'wackler-national', 'honold', 'dachser'].forEach((k) => ts.set(k, 'ready', ''));
  ts.set('wackler-intl', 'unwired', 'engine-hook-missing');
  assert.equal(ts.snapshot().aggregate, 'error');
});

test('insecure -> error with no https in the detail', () => {
  const { ts, els } = renderContext(ALL);
  ['wackler-intl', 'wackler-national', 'dachser'].forEach((k) => ts.set(k, 'ready', ''));
  ts.set('honold', 'insecure', 'no-crypto');
  assert.equal(ts.snapshot().aggregate, 'error');
  assert.match(els.tariffStatusDetail.textContent, /Honold: no https/);
});

test('the denominator comes from data-datasets, not from what was reported', () => {
  const { ts, els } = renderContext('honold dachser');
  ts.set('honold', 'ready', '');
  ts.set('dachser', 'locked', '');
  assert.equal(ts.snapshot().aggregate, 'partial');
  assert.equal(els.tariffStatusValue.textContent, '1/2');
  ts.set('wackler-intl', 'ready', '');
  assert.equal(ts.snapshot().aggregate, 'partial');
  assert.equal(els.tariffStatusValue.textContent, '1/2');
  assert.equal(ts.snapshot().keys.length, 2);
});

test('a page where only some loaders reported settles the rest to missing, not to a happy count', () => {
  /* Half the loaders ran and succeeded. Without settle() the two unreported keys
     are merely pending, which reads as "still loading" forever; settle() is what
     turns a loader that never ran into the problem it is. */
  const { ts, els, chip, listeners } = renderContext(ALL);
  ts.set('wackler-intl', 'ready', '');
  ts.set('wackler-national', 'ready', '');
  assert.equal(ts.snapshot().aggregate, 'loading');
  listeners.load();
  assert.equal(ts.snapshot().states.honold.state, 'missing');
  assert.equal(ts.snapshot().states.dachser.state, 'missing');
  assert.equal(ts.snapshot().aggregate, 'error');
  assert.equal(chip.getAttribute('data-state'), 'error');
  assert.equal(els.tariffStatusValue.textContent, 'problem');
});

test('settle marks unreported declared keys missing, and is idempotent', () => {
  const { ts, chip, listeners } = renderContext('honold dachser');
  assert.equal(typeof listeners.load, 'function');
  listeners.load();
  assert.equal(ts.snapshot().states.honold.state, 'missing');
  assert.equal(ts.snapshot().aggregate, 'error');
  assert.equal(chip.getAttribute('data-state'), 'error');
  const first = JSON.stringify(ts.snapshot());
  ts.settle();
  assert.equal(JSON.stringify(ts.snapshot()), first);
});

test('no chip element: set does not throw and the state is still recorded', () => {
  const ctx = load({ document: { getElementById: () => null } });
  assert.doesNotThrow(() => ctx.TariffStatus.set('honold', 'locked', ''));
  assert.equal(ctx.TariffStatus.snapshot().states.honold.state, 'locked');
  assert.deepEqual(Array.from(ctx.TariffStatus.snapshot().keys), ['honold']);
});

test('a bare context without document or addEventListener still works', () => {
  const ctx = load({});
  assert.doesNotThrow(() => ctx.TariffStatus.set('dachser', 'error', 'bundle-rejected'));
  assert.equal(ctx.TariffStatus.snapshot().aggregate, 'error');
  assert.doesNotThrow(() => ctx.TariffStatus.settle());
  assert.deepEqual(Array.from(ctx.TariffStatus.snapshot().keys), ['dachser']);
});
