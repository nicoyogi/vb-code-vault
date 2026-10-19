/*
 * assets/tariff-status.js is the report the three tariff loaders write into, and
 * it renders both the header chip and the tariff list dialog. The state machine is
 * tested in a bare node:vm context (no document, no addEventListener); the render
 * path uses recording element stubs that stand in for the static markup in
 * anmerkung.html.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../assets/tariff-status.js', import.meta.url), 'utf8');
const KEYS = ['wackler-intl', 'wackler-national', 'honold', 'dachser'];
const ALL = KEYS.join(' ');

function load(globals) {
  const ctx = vm.createContext({ ...globals });
  vm.runInContext(SRC, ctx, { filename: 'tariff-status.js' });
  return ctx;
}

function makeChip(declared) {
  const attrs = new Map();
  const listeners = {};
  if (declared) attrs.set('data-datasets', declared);
  return {
    title: '',
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    click: () => listeners.click(),
  };
}

const DLG_RECT = { left: 100, top: 100, right: 580, bottom: 400 };

function makeDialog() {
  const listeners = {};
  return {
    open: false,
    shown: 0,
    closes: 0,
    showModal() { this.shown++; this.open = true; },
    close() { this.closes++; this.open = false; },
    getBoundingClientRect: () => DLG_RECT,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    emit: (type, event) => listeners[type](event),
  };
}

function makeRow() {
  const attrs = new Map();
  return {
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
  };
}

function makeAnnounce() {
  const attrs = new Map();
  let text = '';
  return {
    writes: 0,
    get textContent() { return text; },
    set textContent(value) { text = String(value); this.writes++; },
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
  };
}

function renderContext(declared) {
  const chip = makeChip(declared);
  const dlg = makeDialog();
  const els = {
    tariffStatus: chip,
    tariffStatusValue: { textContent: '' },
    tariffStatusDetail: { textContent: '' },
    tariffStatusAnnounce: makeAnnounce(),
    dlgTariff: dlg,
    tariffFoot: { hidden: true, textContent: '' },
  };
  KEYS.forEach((k) => {
    els['tariffRow-' + k] = makeRow();
    els['tariffRowState-' + k] = { textContent: '' };
    els['tariffRowWhy-' + k] = { textContent: '' };
  });
  const listeners = {};
  const ctx = load({
    document: { getElementById: (id) => els[id] || null },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  });
  return { ctx, ts: ctx.TariffStatus, chip, dlg, els, listeners };
}

const rowState = (els, k) => els['tariffRow-' + k].getAttribute('data-state');
const rowWord = (els, k) => els['tariffRowState-' + k].textContent;
const rowWhy = (els, k) => els['tariffRowWhy-' + k].textContent;

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

test('the dialog lists every declared dataset with the same words as the sr-only sentence', () => {
  const { ts, els } = renderContext(ALL);
  ts.set('wackler-intl', 'ready', '');
  ts.set('wackler-national', 'locked', 'wrong-passphrase');
  ts.set('honold', 'unavailable', '');
  ts.settle();
  assert.equal(rowState(els, 'wackler-intl'), 'ready');
  assert.equal(rowWord(els, 'wackler-intl'), 'loaded');
  assert.equal(rowWhy(els, 'wackler-intl'), '');
  assert.equal(rowState(els, 'wackler-national'), 'locked');
  assert.equal(rowWord(els, 'wackler-national'), 'locked');
  assert.equal(rowWhy(els, 'wackler-national'), 'passphrase rejected');
  assert.equal(rowState(els, 'honold'), 'unavailable');
  assert.equal(rowWord(els, 'honold'), 'unavailable');
  assert.equal(rowState(els, 'dachser'), 'missing');
  assert.equal(rowWord(els, 'dachser'), 'did not load');
  const sentence = els.tariffStatusDetail.textContent;
  assert.match(sentence, /Wackler international: loaded/);
  assert.match(sentence, /Wackler national: locked \(passphrase rejected\)/);
  assert.match(sentence, /Honold: unavailable/);
  assert.match(sentence, /Dachser: did not load/);
});

test('the live region announces the count, then the problem', () => {
  /* The sr-only sentence is all a screen reader hears when the chip changes, so
     the exact strings are pinned; a substring match would survive a lost prefix. */
  const { ts, els } = renderContext(ALL);
  KEYS.forEach((k) => ts.set(k, 'ready', ''));
  assert.equal(els.tariffStatusAnnounce.textContent, 'Tariff data: 4/4');
  /* A render with unchanged state must not rewrite the region: some screen
     readers re-announce identical text. */
  const writes = els.tariffStatusAnnounce.writes;
  ts.settle();
  assert.equal(els.tariffStatusAnnounce.textContent, 'Tariff data: 4/4');
  assert.equal(els.tariffStatusAnnounce.writes, writes);
  ts.set('dachser', 'error', 'bundle-rejected');
  assert.equal(els.tariffStatusAnnounce.textContent, 'Tariff data: problem');
  assert.equal(els.tariffStatusAnnounce.writes, writes + 1);
  const late = renderContext('honold dachser');
  late.ts.set('honold', 'ready', '');
  late.ts.settle();
  assert.equal(late.els.tariffStatusAnnounce.textContent, 'Tariff data: problem');
});

test('the footer names the unlock control while a dataset is locked', () => {
  const { ts, els } = renderContext(ALL);
  KEYS.forEach((k) => ts.set(k, 'ready', ''));
  assert.equal(els.tariffFoot.hidden, true);
  assert.equal(els.tariffFoot.textContent, '');
  ts.set('honold', 'locked', '');
  assert.equal(els.tariffFoot.hidden, false);
  assert.match(els.tariffFoot.textContent, /Unlock tariff data/);
  ts.set('honold', 'locked', 'wrong-passphrase');
  assert.equal(els.tariffFoot.hidden, false);
  ts.set('honold', 'ready', '');
  assert.equal(els.tariffFoot.hidden, true);
  assert.equal(els.tariffFoot.textContent, '');
});

test('the chip opens the dialog once and tracks aria-expanded', () => {
  const { chip, dlg, els } = renderContext(ALL);
  chip.click();
  assert.equal(dlg.shown, 1);
  assert.equal(chip.getAttribute('aria-expanded'), 'true');
  chip.click();
  assert.equal(dlg.shown, 1);
  dlg.emit('close', {});
  assert.equal(chip.getAttribute('aria-expanded'), 'false');
  assert.equal(rowWord(els, 'honold'), 'waiting');
});

test('a point outside the dialog closes it, a point inside its padding does not', () => {
  const { chip, dlg } = renderContext(ALL);
  chip.click();
  /* A non-dialog target outside the box is the case the target guard exists for:
     the geometry test alone would close the dialog. */
  dlg.emit('click', { target: {}, clientX: DLG_RECT.right + 1, clientY: 250 });
  assert.equal(dlg.closes, 0);
  /* The 18px padding ring targets the dialog itself, but it is inside the box. */
  dlg.emit('click', { target: dlg, clientX: 110, clientY: 110 });
  assert.equal(dlg.closes, 0);
  dlg.emit('click', { target: dlg, clientX: DLG_RECT.right + 1, clientY: 250 });
  assert.equal(dlg.closes, 1);
  assert.equal(dlg.open, false);
});

test('the static dialog rows are exactly the declared datasets, in order', () => {
  const html = readFileSync(new URL('../anmerkung.html', import.meta.url), 'utf8');
  const declared = html.match(/data-datasets="([^"]+)"/)[1].split(/\s+/);
  const start = html.indexOf('id="dlgTariff"');
  const dialog = html.slice(start, html.indexOf('</dialog>', start));
  const rows = Array.from(dialog.matchAll(/data-dataset="([^"]+)"/g), (m) => m[1]);
  assert.deepEqual(rows, declared);
  /* renderRows looks these up by id and every lookup is null-guarded, so a renamed
     id would leave that row on "checking" with every test green. */
  for (const k of declared) {
    for (const prefix of ['tariffRow', 'tariffRowState', 'tariffRowWhy']) {
      assert.ok(dialog.includes(`id="${prefix}-${k}"`), `anmerkung.html has no id="${prefix}-${k}"`);
    }
  }
});
