/*
 * Unit tests for the Außertariflich approval rule (release 1.65.0).
 *
 * One wrapper sits between the three places that run a processor and the
 * processor itself: a row whose ReferenzNr is on the shipped out-of-tariff
 * approval list reads exactly `OK`, replacing every finding the processor would
 * have produced. A skipped row (processor `null`) is never touched.
 *
 * Owner ruling 2026-11-18 (.agent/artifacts/plan-aussertariflich-ok-2026-11-18.md):
 * a row is approved only when EVERY reference on it is listed. The design's
 * earlier "any reference approves" call is superseded, so a bundled cell with one
 * unlisted number keeps its findings. That is the fail-closed direction and the
 * Wackler witness below pins it.
 *
 * The list itself ships as assets/aussertariflich.js, loaded by the harness
 * before the engine. Tests swap it through `setAussertariflich` (a fresh array
 * object is what invalidates the engine's identity-keyed Set; an in-place push on
 * the current array is not observable).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadEngine, makeRow } from './harness/load-engine.mjs';

const e = loadEngine();

/* Engine arrays come from the vm realm (foreign Array.prototype); re-wrap into a
   host array before structural comparison. */
const A = (x) => Array.from(x);

const R = 3; // makeRow index for Excel row 4, the first data row

/* The shipped asset as the harness loaded it, captured before any test swaps the
   list. null means assets/aussertariflich.js is missing or did not parse. */
const SHIPPED = e.context.window.AUSSERTARIFLICH;

/* A Dachser layout, shaped like resolveDachser's result: the surface columns the
   processor reads plus the Anmerkung column and the row's own reference. */
function dachserCols(extra = {}) {
  return {
    target: 5, stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54,
    serv_art: 55, referenz: 56, ...extra,
  };
}

/* The 2.Zustellung row from tests/processors.test.mjs (bundle 2026-09-18,
   row 7d6db19e): a real finding under stat 10. */
function zzRow(referenz, stat = '10') {
  return makeRow(R, { 50: stat, 51: '700.92', 52: '936.15', 53: '865.38', 54: '70.77', 55: 'K1AV', 56: referenz });
}

/* ── approvedReference: the matcher ── */

test('approvedReference: every listed reference on a row comes back, joined', () => {
  e.setAussertariflich(['2544666780', '2544666766']);
  const cols = dachserCols();
  assert.equal(e.approvedReference(makeRow(R, { 50: '10', 56: '2544666780' }), R, cols),
    '2544666780', 'a single listed reference approves the row');
  assert.equal(e.approvedReference(makeRow(R, { 50: '10', 56: '2544666766,2544666780' }), R, cols),
    '2544666766, 2544666780', 'both approvals travel back for the reason line');
});

test('approvedReference: one unlisted reference withholds approval', () => {
  /* Every-reference ruling: partial bundling does not approve, so a stray or
     mistyped number leaves the row with today's note (fail-closed). */
  e.setAussertariflich(['2544666766', '2544666780']);
  const cols = dachserCols();
  assert.equal(e.approvedReference(makeRow(R, { 50: '10', 56: '2544666766,2544666781' }), R, cols),
    '', 'one unlisted number is enough to withhold OK');
  assert.equal(e.approvedReference(makeRow(R, { 50: '10', 56: '2544666790,2544666791' }), R, cols),
    '', 'a row with no listed reference is not approved');
});

test('approvedReference: blank, "-", a 5-digit and a 21-digit value never match', () => {
  /* 6..20 digits is the token floor. The 21-digit case proves the upper bound
     too: the scan can only hand back the 20-digit prefix, so an exactly-listed
     21-digit number still misses. */
  e.setAussertariflich(['12345', '123456789012345678901']);
  const cols = dachserCols();
  for (const value of ['', '-', '   ', '12345']) {
    assert.equal(e.approvedReference(makeRow(R, { 50: '10', 56: value }), R, cols), '',
      JSON.stringify(value) + ' is below the 6-digit floor');
  }
  assert.equal(e.approvedReference(makeRow(R, { 50: '10', 56: '123456789012345678901' }), R, cols),
    '', '21 digits is above the 20-digit ceiling');
});

test('approvedReference: no asset and an empty list behave as 1.64.0', () => {
  const cols = dachserCols();
  const ws = makeRow(R, { 50: '10', 56: '2544666780' });
  e.setAussertariflich(null);
  assert.equal(e.AUSSERTARIFLICH, null, 'the accessor agrees the asset is gone');
  assert.equal(e.approvedReference(ws, R, cols), '');
  e.setAussertariflich([]);
  assert.equal(e.approvedReference(ws, R, cols), '', 'an empty list approves nothing');
});

test('approvedReference: a layout without a ReferenzNr column never matches', () => {
  /* The safety net for a future layout that drops the column: an absent key and a
     resolved -1 both have to stay silent, never read a neighbouring cell. */
  e.setAussertariflich(['2544666780']);
  const ws = makeRow(R, { 50: '10', 51: '2544666780', 56: '2544666780' });
  assert.equal(e.approvedReference(ws, R, { target: 5, stat: 50 }), '');
  assert.equal(e.approvedReference(ws, R, dachserCols({ referenz: -1 })), '');
});

/* ── DHL and Honold read ReferenzNr too ── */

/* Both carrier layouts resolve their columns from row 2 and row 3 headers, so the
   resolver test needs a sheet and not just a data row. ReferenzNr sits at column E
   (index 4) on both, the way the real workbooks carry it. */
const LAYOUT = { s: { r: 0, c: 0 }, e: { r: 3, c: 12 } };
function layout(row2, row3, data) {
  const ws = makeRow(1, row2);
  Object.assign(ws, makeRow(2, row3));
  Object.assign(ws, makeRow(R, data));
  return ws;
}
const HEAD3 = { 0: 'Anmerkung', 4: 'ReferenzNr', 10: 'Stat_Freigabe' };
/* addr (FR Differenz) over T_DHL is a real DHL finding. */
const dhlLayout = (referenz) =>
  layout({ 12: 'FR' }, { ...HEAD3, 12: 'Differenz' }, { 4: referenz, 10: '10', 12: '5' });
/* A blank FR Kosten DL is the Honold weight phrase, so it needs no rate card beyond
   a ready tariff. */
const honoldLayout = (referenz) =>
  layout({ 12: 'FR' }, { ...HEAD3, 12: 'Kosten DL' }, { 4: referenz, 10: '10' });
/* The smallest tariff honoldTariff() accepts: one country, one zone, one rate. */
const MIN_TARIFF = { tiers: [100], zones: { 'AT1 Österreich': [918.88] }, codes: { AT: ['AT1 Österreich'] } };

function withMinTariff(fn) {
  const real = e.HONOLD_TARIFF;
  e.setHonoldTariff(MIN_TARIFF);
  try { return fn(); } finally { e.setHonoldTariff(real); }
}

test('resolveDHL and resolveHonold map ReferenzNr, so a listed reference approves the row', () => {
  /* Both sheets carry the column (measured 2026-11-20 on STRR000840258 and 20379045,
     row 3); the rule used to be unreachable for them only because neither resolver
     read it. Driven by the SHIPPED list, so this is the asset the app ships. */
  if (!SHIPPED) assert.fail('the shipped approval list did not load');
  e.setAussertariflich(SHIPPED.refs);
  const dhlCols = e.resolveDHL(dhlLayout('2544666780'), LAYOUT);
  assert.equal(dhlCols.referenz, 4, 'resolveDHL reads the ReferenzNr column');
  const honoldCols = e.resolveHonold(honoldLayout('2544666780'), LAYOUT);
  assert.equal(honoldCols.referenz, 4, 'resolveHonold reads the ReferenzNr column');

  const dhl = dhlLayout('2544666780');
  assert.equal(e.processDHL(dhl, R, dhlCols), 'Differenz aufgrund von abweichendem Gewicht/Volumen',
    'the DHL row has a finding today');
  assert.equal(e.rowAnmerkung(e.processDHL, dhl, R, dhlCols), 'OK',
    'a listed reference approves the DHL row');

  withMinTariff(() => {
    const honold = honoldLayout('2544666780');
    assert.equal(e.processHonold(honold, R, honoldCols), 'Differenz aufgrund abweichender Gewichte',
      'the Honold row has a finding today');
    assert.equal(e.rowAnmerkung(e.processHonold, honold, R, honoldCols), 'OK',
      'a listed reference approves the Honold row');
  });
});

test('resolveDHL and resolveHonold: an unlisted reference keeps the processor phrase', () => {
  if (!SHIPPED) assert.fail('the shipped approval list did not load');
  e.setAussertariflich(SHIPPED.refs);
  const dhlCols = e.resolveDHL(dhlLayout('2544666781'), LAYOUT);
  const dhl = dhlLayout('2544666781');
  const dhlBase = e.processDHL(dhl, R, dhlCols);
  assert.equal(dhlBase, 'Differenz aufgrund von abweichendem Gewicht/Volumen');
  assert.equal(e.rowAnmerkung(e.processDHL, dhl, R, dhlCols), dhlBase,
    'the processor phrase, unchanged');

  const honoldCols = e.resolveHonold(honoldLayout('2544666781'), LAYOUT);
  withMinTariff(() => {
    const honold = honoldLayout('2544666781');
    const honoldBase = e.processHonold(honold, R, honoldCols);
    assert.equal(honoldBase, 'Differenz aufgrund abweichender Gewichte');
    assert.equal(e.rowAnmerkung(e.processHonold, honold, R, honoldCols), honoldBase,
      'the processor phrase, unchanged');
  });
});

/* ── rowAnmerkung: the wrapper ── */

test('rowAnmerkung: a skipped row stays null, listed reference or not', () => {
  e.setAussertariflich(['2544666780']);
  const cols = dachserCols();
  for (const stat of ['30', '20']) {
    const ws = zzRow('2544666780', stat);
    assert.equal(e.processDachser(ws, R, cols), null, 'the processor skips stat ' + stat);
    assert.equal(e.rowAnmerkung(e.processDachser, ws, R, cols), null,
      'the rule never writes into a skipped row');
  }
  /* The passthrough and the released-gate re-assert are separate guards: a
     processor can also skip at stat 10 (Honold without a tariff), and a future
     branch could return a phrase below the gate. Both are pinned here, through
     the wrapper's own contract, so neither can be dropped as redundant. */
  assert.equal(e.rowAnmerkung(() => null, zzRow('2544666780'), R, cols), null,
    'a skipped row is not turned into OK by a listed reference');
  assert.equal(e.rowAnmerkung(() => 'Fake finding', zzRow('2544666780', '20'), R, cols),
    'Fake finding', 'an unreleased row keeps its finding even when the reference is listed');
});

test('rowAnmerkung: an approved row overrides every finding', () => {
  e.setAussertariflich(['2544666780']);
  const cols = dachserCols();
  const ws = zzRow('2544666780');
  assert.equal(e.processDachser(ws, R, cols), '931,15 Kosten für 2.Zustellung etc. ok?',
    'the processor reports a real finding on this row');
  assert.equal(e.rowAnmerkung(e.processDachser, ws, R, cols), 'OK',
    'the approval replaces the finding, and nothing is appended to it');
});

test('rowAnmerkung: a row whose reference is not listed keeps the processor phrase', () => {
  e.setAussertariflich(['2544666780']);
  const cols = dachserCols();
  const ws = zzRow('2544666781');
  const base = e.processDachser(ws, R, cols);
  assert.equal(base, '931,15 Kosten für 2.Zustellung etc. ok?');
  assert.equal(e.rowAnmerkung(e.processDachser, ws, R, cols), base, 'byte-identical to 1.64.0');
});

test('rowAnmerkung: an approved row with no findings reads OK, and an open stat gate approves on the reference alone', () => {
  e.setAussertariflich(['2544666780']);
  const cols = dachserCols();
  const quiet = makeRow(R, { 50: '10', 56: '2544666780' });
  assert.equal(e.processDachser(quiet, R, cols), '', 'this row has nothing to report today');
  assert.equal(e.rowAnmerkung(e.processDachser, quiet, R, cols), 'OK', 'OK, not blank');
  /* No Stat_Freigabe header (cols.stat < 0) leaves the gate open today, so the
     reference alone decides. Documented consequence of the rule as written. */
  const openCols = { target: 5, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55, referenz: 56 };
  assert.equal(e.rowAnmerkung(e.processDachser, zzRow('2544666780').valueOf(), R, openCols), 'OK',
    'an open gate approves on the reference');
});

/* ── phrase catalog + reason line ── */

test('phrase catalog: OK resolves to the key ok', () => {
  assert.equal(e.phraseToKey('OK'), 'ok');
  assert.equal(e.phraseToKey('  ok  '), 'ok', 'trimmed and case-folded like every other key');
  assert.equal(e.phraseToKey('Ok'), 'ok');
  assert.deepStrictEqual(A(e.phraseKeysFor(['Frachtdifferenz', 'OK'])), ['frachtDiff', 'ok'],
    'a two-phrase cell keys the tariff finding and the approval separately');
});

test('buildPhraseEmitterIndex: ok is emitted by the wrapper alone', () => {
  const idx = e.buildPhraseEmitterIndex();
  assert.deepStrictEqual(A(idx.ok), ['rowAnmerkung'], 'the wrapper is the only emitter of OK');
  /* The emitter scan reads string literals out of each function body, so a phrase
     literal in the wrapper would credit it for that phrase. These two came back
     misattributed once already (from a comment in the wrapper) - pinned so it
     cannot come back unnoticed. */
  assert.ok(!A(idx.kontierungQ).includes('rowAnmerkung'), 'the wrapper does not emit Kontierung?');
  assert.ok(!A(idx.kontierungLower).includes('rowAnmerkung'), 'the wrapper does not emit kontierung?');
  const unemitted = Object.entries(idx).filter(([, keys]) => !keys.length).map(([k]) => k);
  assert.deepStrictEqual(unemitted, ['gutschriftErhalten', 'overweight'],
    'every other catalog key still resolves to an emitter');
});

test('buildReason: an OK row names the approval, every other row is unchanged', () => {
  e.setAussertariflich(['2544666780']);
  const cols = dachserCols();
  const ws = zzRow('2544666780');
  assert.equal(e.buildReason('dachser', ws, R, cols, 'OK'), 'Außertariflich freigegeben: 2544666780');
  /* A 4-argument call is what tests/processors.test.mjs makes, and what every
     non-approved row gets: the inputs, never the approval trace. */
  const plain = e.buildReason('dachser', ws, R, cols);
  assert.ok(!plain.includes('Außertariflich'), 'a non-OK row gets no approval prefix');
  assert.ok(plain.includes('STAT=10'), 'a non-OK row still prints its inputs');
});

/* ── the shipped list, witnessed on real rows ── */

test('bundle witness: Wackler 10362192 r63 reads OK, r67 keeps its finding', () => {
  /* Measured off D:\TESTER\Wackler\10362192 Soll-Ist-Vergleich.xlsx (2026-11-20).
     r63 carries 8 references, all on the list. r67 carries 8 and only 7 of them
     are listed: 2544213873 appears nowhere in the approval workbook. */
  if (!SHIPPED) assert.fail('the shipped approval list did not load');
  e.setAussertariflich(SHIPPED.refs);
  const wcols = {
    target: 56, stat: 33, referenz: 4, avis_diff: 40, fr: 43, maut: 46,
    tz: 52, tarif: 54, colli: 21, vkg: 30,
  };
  const r63 = '2544295123,2544295049,2544295304,2544295305,2544295306,2544295308,2544295100,2544317110';
  const r67 = '2544317142,2544295347,2544295352,2544295180,2544295183,2544295184,2544317156,2544213873';

  const row63 = makeRow(R, { 4: r63, 33: '10', 40: '8.7' });
  assert.equal(e.processWackler(row63, R, wcols), 'Avis, ok?', 'r63 has a real finding today');
  assert.equal(e.rowAnmerkung(e.processWackler, row63, R, wcols), 'OK', '8 of 8 approvals');

  const row67 = makeRow(R, { 4: r67, 21: '33', 30: '5357', 33: '10', 43: '35.99', 52: '3.24', 54: '599.38' });
  assert.equal(e.processWackler(row67, R, wcols), 'hätte gebündelt werden müssen',
    'r67 has its own finding today');
  assert.equal(e.rowAnmerkung(e.processWackler, row67, R, wcols), 'hätte gebündelt werden müssen',
    '7 of 8 is not approval - the unlisted shipment keeps the finding');
});

test('the shipped asset loads through the harness with 1,112 references', () => {
  /* Read through the harness path first: this is what load-engine.mjs put on the
     vm context before any test ran. A malformed or unloaded asset leaves every
     other test above green while approving nothing, so it is asserted here. */
  assert.ok(SHIPPED, 'assets/aussertariflich.js did not load in the harness');
  assert.equal(SHIPPED.generated, '2026-11-18');
  assert.equal(SHIPPED.refs.length, 1112);

  /* Then the file itself, evaluated the way the browser loads it. */
  const src = readFileSync(new URL('../assets/aussertariflich.js', import.meta.url), 'utf8');
  e.evalInContext(src);
  const asset = e.context.window.AUSSERTARIFLICH;
  assert.ok(asset.refs.every((ref) => /^\d{6,20}$/.test(ref)), 'every entry is a 6..20 digit reference');
  assert.ok(asset.refs.includes('2544666780'), 'Amazon r106 is on the list');
  assert.ok(!asset.refs.includes('12345'), 'a 5-digit value is not');
  assert.equal(e.approvedReference(makeRow(R, { 50: '10', 56: '2544666780' }), R, dachserCols()),
    '2544666780', 'the real list approves a real reference');
});

/* ── wiring: every processor call goes through the wrapper ── */

/* Every test above drives rowAnmerkung itself, so all fourteen stay green if the
   app stops calling it: a reverted call site approves nothing in the shipped
   tool and nothing here notices. The three sites are browser-bound (runRules
   reads the loaded workbook, runTester renders into #testerOutput, diffWorkbooks
   takes two XLSX workbooks), so what a test can reach is the call shape at each
   one: the processor reaches a row only as rowAnmerkung's first argument.
   Whitespace may move in a reformat; the wrapper name and its arguments may not. */
const ENGINE_SRC = readFileSync(new URL('../assets/anmerkung.js', import.meta.url), 'utf8');

test('wiring: all three processor call sites go through rowAnmerkung', () => {
  assert.equal((ENGINE_SRC.match(/function rowAnmerkung\(/g) || []).length, 1,
    'one wrapper, so the three sites below all reach the same one');

  /* runRules, the full-sheet run. */
  assert.match(ENGINE_SRC, /const result\s*=\s*rowAnmerkung\(\s*fn\s*,\s*ws\s*,\s*r\s*,\s*cols\s*\)/,
    'runRules must take its result from the wrapper');
  assert.doesNotMatch(ENGINE_SRC, /const result\s*=\s*fn\s*\(/,
    'runRules must not call the processor directly: a plain fn(ws,r,cols) approves nothing');

  /* diffWorkbooks, the A/B drift scan. Its engine-now prediction has to be the
     phrase the app writes, or an approved row is reported as engine drift. */
  assert.match(ENGINE_SRC, /const p\s*=\s*rowAnmerkung\(\s*processor\s*,\s*wsA\s*,\s*r\s*,\s*colsA\s*\)/,
    'the drift scan must predict through the wrapper');
  assert.doesNotMatch(ENGINE_SRC, /const p\s*=\s*processor\s*\(/,
    'the drift scan must not call the processor directly');

  /* runTester, one branch per forwarder. */
  for (const [fw, proc] of [['dachser', 'processDachser'], ['kn', 'processKN'], ['dhl', 'processDHL'],
    ['honold', 'processHonold'], ['wackler', 'processWackler']]) {
    assert.match(ENGINE_SRC, new RegExp(`result\\s*=\\s*rowAnmerkung\\(\\s*${proc}\\s*,\\s*ws\\s*,\\s*3\\s*,\\s*cols\\s*\\)`),
      `the ${fw} Tester branch must call the wrapper`);
    assert.doesNotMatch(ENGINE_SRC, new RegExp(`result\\s*=\\s*${proc}\\s*\\(`),
      `the ${fw} Tester branch must not call ${proc} directly`);
  }
});
