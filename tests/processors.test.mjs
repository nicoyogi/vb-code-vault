/*
 * Unit tests for the four forwarder rule processors.
 *
 * Each processor takes (ws, r, cols): an XLSX worksheet, a 0-based row index,
 * and a resolved column-index map. We build a fake single-row worksheet with
 * makeRow() and pass an explicit cols map, so no real .xlsx / header parsing is
 * involved -- the tests exercise the rule logic in isolation.
 *
 * Column indices for the cols map start at 50 to avoid colliding with the
 * fixed Dachser columns the engine reads directly (ANZ_SDG=3, EMPF_PLZ=13,
 * EMPF_ORT=14, REFERENZ3=15, SERV_ART=16, SACHKONTO=35).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeRow } from './harness/load-engine.mjs';

const e = loadEngine();
const R = 3; // arbitrary data row

/* ──────────────────────────────────────────────────────────
   DACHSER
─────────────────────────────────────────────────────────── */
test('processDachser: STAT != 10 returns null (row not released)', () => {
  const cols = { stat: 50 };
  const ws = makeRow(R, { 50: 5 });
  assert.equal(e.processDachser(ws, R, cols), null);
});

test('processDachser: toll delta -> Mautdifferenz', () => {
  const cols = { stat: 50, tarif: 51, maut: 52 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '5' });
  assert.equal(e.processDachser(ws, R, cols), 'Mautdifferenz');
});

test('processDachser: FR delta, weights unknown -> singular "abweichendem Gewicht"', () => {
  const cols = { stat: 50, tarif: 51, fr: 52 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '26.24' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz aufgrund von abweichendem Gewicht');
});

test('processDachser: FR delta crossing a weight tier -> plural "abweichender Gewichte"', () => {
  // VKG=54 (tier 100) vs VKG_DL=40 (tier 50) cross the 50/100 boundary
  const cols = { stat: 50, tarif: 51, fr: 52, vkg: 53, vkg_dl: 54 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '26.24', 53: '54', 54: '40' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz aufgrund abweichender Gewichte');
});

test('processDachser: small negative FR -> "Differenz Frachtzu/ abschlag"', () => {
  const cols = { stat: 50, tarif: 51, fr: 52 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '-0.09' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Frachtzu/ abschlag');
});

test('processDachser: blank TARIF + FR, no SACH/SERV -> VORHOLUNG', () => {
  const cols = { stat: 50, tarif: 51, fr: 52 };
  // col 51 left unset => tarifRaw === ''
  const ws = makeRow(R, { 50: 10, 52: '646.7' });
  assert.equal(e.processDachser(ws, R, cols), 'VORHOLUNG');
});

test('processDachser: blank TARIF + FR with SERV/SACH -> Fremdnummer Doppelt berechnet', () => {
  const cols = { stat: 50, tarif: 51, fr: 52 };
  // SERV_ART=16, SACHKONTO=35 populated => the Fremdnummer branch
  const ws = makeRow(R, { 50: 10, 52: '47.2', 16: 'DA01', 35: '612100' });
  assert.equal(e.processDachser(ws, R, cols), 'Fremdnummer Doppelt berechnet');
});

test('processDachser: SNK_DL=190 -> AUSFALLFRACHT', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 190, 53: 0 });
  assert.equal(e.processDachser(ws, R, cols), 'AUSFALLFRACHT');
});

test('processDachser: cents SNK_DL re-derives code 9 -> tel. Zustellterminvereinbarung', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '14.72', 53: '9.01' });
  assert.equal(
    e.processDachser(ws, R, cols),
    'Differenz Telefonische Zustellterminvereinbarung - Laderaumzuschlag',
  );
});

/* ──────────────────────────────────────────────────────────
   K+N
─────────────────────────────────────────────────────────── */
test('processKN: STAT != 10 returns null', () => {
  const cols = { stat: 50 };
  const ws = makeRow(R, { 50: 0 });
  assert.equal(e.processKN(ws, R, cols), null);
});

// every K+N field gets a real column index; unpopulated cells read as 0/''
const KN_COLS = {
  stat: 50, tarif: 51, recip: 52, referenz: 53, vkg: 54, vkg_dl: 55,
  kost: 56, sach: 57, fr: 58, exp: 59, toll: 60, snk_dl: 61, snk_diff: 62, fuel: 63,
};

test('processKN: FR delta on empty tariff -> Pauschalfracht', () => {
  // tarif col left blank => tarifEmpty; kost/sach filled so no Kontierung
  const ws = makeRow(R, { 50: 10, 58: '5', 56: '123', 57: '456' });
  assert.equal(e.processKN(ws, R, KN_COLS), 'Pauschalfracht');
});

test('processKN: multi-doc ReferenzNr + FR -> bundling (early return)', () => {
  const ws = makeRow(R, { 50: 10, 58: '5', 53: '123,456', 51: '100' });
  assert.equal(e.processKN(ws, R, KN_COLS), 'hätte gebündelt werden müssen, ok?');
});

test('processKN: Amazon recipient + single ref -> Amazon-Tarif müssen', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 58: '5', 52: 'Amazon EU', 56: '1', 57: '2' });
  assert.equal(e.processKN(ws, R, KN_COLS), 'hätte nach Amazon Tarif abrechnen müssen');
});

test('processKN: SNK_DIFF ~= 9 -> "Avis, ok?"', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 62: '9', 56: '1', 57: '2' });
  assert.equal(e.processKN(ws, R, KN_COLS), 'Avis, ok?');
});

test('processKN: toll delta suppresses the fuel byproduct -> only Mautdifferenz', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 60: '5', 63: '5', 56: '1', 57: '2' });
  assert.equal(e.processKN(ws, R, KN_COLS), 'Mautdifferenz');
});

test('processKN: standalone fuel delta -> "Differenz treibstoff"', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 63: '5', 56: '1', 57: '2' });
  assert.equal(e.processKN(ws, R, KN_COLS), 'Differenz treibstoff');
});

test('processKN: blank cost-centre / account -> Kontierung?', () => {
  const ws = makeRow(R, { 50: 10, 51: '100' }); // kost/sach blank
  assert.equal(e.processKN(ws, R, KN_COLS), 'Kontierung?');
});

/* ──────────────────────────────────────────────────────────
   DHL EXPRESS
─────────────────────────────────────────────────────────── */
const DHL_COLS = {
  stat: 50, tarif: 51, sach: 52, kost: 53, addr: 54, stack: 55, weight: 56,
  conv: 57, irr: 58, neut: 59, sign: 60, snk: 61, diff: 62, maut: 63, surc: 64, over: 65, tz: 66,
};

test('processDHL: STAT != 10 returns null', () => {
  const ws = makeRow(R, { 50: 7 });
  assert.equal(e.processDHL(ws, R, DHL_COLS), null);
});

test('processDHL: zero tariff with text -> Fremdnummer doppelt berechnet.', () => {
  const ws = makeRow(R, { 50: 10, 51: '0' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'Fremdnummer doppelt berechnet.');
});

test('processDHL: FR (address) delta -> weight/volume wording', () => {
  // sach/kost filled to avoid the kontierung lines
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 'S', 53: 'K', 54: '5' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'Differenz aufgrund von abweichendem Gewicht/Volumen');
});

test('processDHL: SNK code 25 -> "Limited quantities ok?"', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 'S', 53: 'K', 61: '25' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'Limited quantities ok?');
});

test('processDHL: conveyable multiple-of-15 -> piece-weight wording', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 'S', 53: 'K', 57: '15' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'Non conveyable piece-weight ok?');
});

test('processDHL: no block triggers, AC=11 -> "Addres Correction, ok?"', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 'S', 53: 'K', 62: '11' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'Addres Correction, ok?');
});

test('processDHL: only a fuel delta -> "Differenz treibstof"', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 'S', 53: 'K', 66: '5' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'Differenz treibstof');
});

/* ──────────────────────────────────────────────────────────
   WACKLER
─────────────────────────────────────────────────────────── */
const W_COLS = {
  target: 50, stat: 51, tarif: 52, avis_diff: 53, snk_diff: 54, fr: 55, maut: 56,
  tz: 57, referenz: 58, vkg: 59, vkg_dl: 60, empf_plz: 61, empf_ort: 62,
  kostenstelle: 63, sachkonto: 64,
};

test('processWackler: protected existing annotation -> null (left untouched)', () => {
  const ws = makeRow(R, { 50: 'Return, ok?' });
  assert.equal(e.processWackler(ws, R, W_COLS), null);
});

test('processWackler: STAT != 10 with blank KOST/SACH -> Kontierung?', () => {
  const ws = makeRow(R, { 51: 5 }); // stat != 10, kost/sach blank
  assert.equal(e.processWackler(ws, R, W_COLS), 'Kontierung?');
});

test('processWackler: STAT != 10 with filled KOST/SACH -> null', () => {
  const ws = makeRow(R, { 51: 5, 63: '12', 64: '34' });
  assert.equal(e.processWackler(ws, R, W_COLS), null);
});

test('processWackler: dash tariff -> Fremdnummer doppelt berechnet', () => {
  const ws = makeRow(R, { 51: 10, 52: '-', 63: '12', 64: '34' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Fremdnummer doppelt berechnet');
});

test('processWackler: dash tariff + blank KOST/SACH -> Fremdnummer // Kontierung', () => {
  const ws = makeRow(R, { 51: 10, 52: '-' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Fremdnummer doppelt berechnet // Kontierung?');
});

test('processWackler: |SNK| >= tariff, no FR/MT/TZ, unknown code -> Pauschalfracht, ok?', () => {
  const ws = makeRow(R, { 51: 10, 52: '54.95', 54: '80', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Pauschalfracht, ok?');
});

test('processWackler: AVIS surcharge code 7.5 -> "Avis, ok?"', () => {
  const ws = makeRow(R, { 51: 10, 52: '100', 53: '7.5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Avis, ok?');
});

test('processWackler: SNK code 38 -> NL-FIX', () => {
  const ws = makeRow(R, { 51: 10, 52: '100', 54: '38', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'NL-FIX');
});

test('processWackler: same-tier weight diff + FR -> "Wackler rechnet Frachtrate ... ab"', () => {
  // VKG=120 and VKG_DL=130 both fall in the 150 kg bucket
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '5', 59: '120', 60: '130', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Wackler rechnet Frachtrate für 150kg ab');
});

test('processWackler: bare FR delta -> Frachtdifferenz', () => {
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Frachtdifferenz');
});

test('processWackler: blank KOST/SACH only -> Kontierung?', () => {
  const ws = makeRow(R, { 51: 10, 52: '100' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Kontierung?');
});

test('processWackler: TZ >= 2.0 alone -> DifferenzTreibstof', () => {
  const ws = makeRow(R, { 51: 10, 52: '100', 57: '5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'DifferenzTreibstof');
});
