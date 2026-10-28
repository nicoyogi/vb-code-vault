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
import { readFileSync } from 'node:fs';
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

test('processDachser: FR delta crossing a weight tier using Brutto kg -> plural "abweichender Gewichte"', () => {
  // brutto=54 (tier 100) vs VKG_DL=40 (tier 50) cross the 50/100 boundary
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54 };
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

test('processDachser: blank TARIF + FR, but has TZ or MT -> do NOT emit VORHOLUNG', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, tz: 53, maut: 54 };
  // Has FR and TZ
  let ws = makeRow(R, { 50: 10, 52: '646.7', 53: '15.2' });
  assert.notEqual(e.processDachser(ws, R, cols), 'VORHOLUNG');

  // Has FR and MT
  ws = makeRow(R, { 50: 10, 52: '646.7', 54: '3.5' });
  assert.notEqual(e.processDachser(ws, R, cols), 'VORHOLUNG');
});

test('processDachser: SACH=X with TARIF + FR delta does not emit VORHOLUNG', () => {
  // SACH=X on normal rows with TARIF + FR must evaluate weight deviations, not VORHOLUNG
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, sachkonto: 35 };
  const ws = makeRow(R, { 50: 10, 51: '64.93', 52: '-9.7', 53: '100.094', 54: '100', 35: 'X' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz aufgrund abweichender Gewichte');
});

test('processDachser: SNK_DL=135 K1AV -> admin fee stripped, 2h waiting time, then the fee line', () => {
  // Bundle 2026-09-18 row 8c7714fd: Amazon-DTM1 rows bundle the flat 5 EUR
  // admin/fenster line into SNK_DL. 135 − 5 = 130 = 2 × 65 EUR.
  //
  // The Wartezeit phrase is the auditor's headline, not the whole note: the
  // bundled admin-fee line is still owed and the sheet appends it. 20260923
  // rows 216/230/308 all read "Wartezeit 2h á 65 EUR, ok? // Differenz Admin
  // Zeitfensterbuchung Handel - Laderaumzuschlag". 20260917 row 97 has the same
  // inputs with the suffix missing, which the user has ruled a worksheet error.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '717.2', 52: '135', 53: '64.48', 54: '70.52', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols),
    'Wartezeit 2h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag');
});

test('processDachser: SNK_DL=936.15 K1AV -> admin fee stripped, itemised 2.Zustellung amount', () => {
  // Bundle 2026-09-18 row 7d6db19e: 936.15 − 5 = 931.15 (cents-residual).
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '700.92', 52: '936.15', 53: '865.38', 54: '70.77', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), '931,15 Kosten für 2.Zustellung etc. ok?');
});

test('processDachser: SNK_DL=265 K1AV -> waiting time scales with the hour count', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '500', 52: '265', 53: '260', 54: '5', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols),
    'Wartezeit 4h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag');
});

test('processDachser: SNK_DL=195 K1AV -> pure 3 x 65 waiting time, no admin-fee suffix', () => {
  // 20261013 row 12 (row_uid 2d5724df): 195 / 65 = 3 exactly; the truth cell is
  // the headline alone. The old expectation (Laderaumkostenentwicklung) read the
  // -5 admin-fee contract into a row that never carried the fee. 20260903 row 218
  // (SNK_DL 195) truth is STANDGELDKOSTEN, a phrase no branch emits, and is wrong
  // under both the old and the new engine.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '94.54', 52: '195', 53: '100.46', 54: '94.54', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), 'Wartezeit 3h á 65 EUR, ok?');
});

test('processDachser: SNK_DL=200 K1AV -> bundled 195 keeps the admin-fee suffix', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '717.2', 52: '200', 53: '195', 54: '5', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols),
    'Wartezeit 3h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag');
});

test('processDachser: SNK_DL=196 K1AV -> a non-pure hour count stays Laderaumkostenentwicklung', () => {
  // The boundary the rewritten 195 case left behind: 196/65 is not whole and
  // 191 after the admin fee is neither a whole hour nor cents-bearing, so the
  // pure-65 branch must not grab it. This is the fallback the old 195 test
  // exercised before 195 became the pure case.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '94.54', 52: '196', 53: '100.46', 54: '94.54', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Laderaumkostenentwicklung');
});

test('processDachser: K1AV SNK_DL 520 and 785 -> waiting time before the 2.Zustellung amount', () => {
  // The >500 2.Zustellung branch sits below the two Wartezeit returns, so a
  // large SNK_DL that is a whole hour count (520 = 8 x 65) still reads the
  // headline alone, while 785 = 780 + 5 keeps the admin-fee suffix. This pins
  // the branch order only and passes at HEAD as well, so it is not a witness of
  // the new behaviour.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  let ws = makeRow(R, { 50: 10, 51: '700.92', 52: '520', 53: '515', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), 'Wartezeit 8h á 65 EUR, ok?');
  ws = makeRow(R, { 50: 10, 51: '700.92', 52: '785', 53: '780', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols),
    'Wartezeit 12h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag');
});

test('processDachser: SNK_DL=130 K1AV -> one two-hour waiting time, not Standgeld', () => {
  // Bundle 2026-10-19 rows 64/81/99/154 (K1AV, 612100): the 130 EUR line is
  // 2 x 65 EUR. Both shapes are covered: row 64 carries a tariff base
  // (SNK_DL 130 / SNK_DIFF 53.36 / SNK lt. Tarif 76.64), row 154 does not
  // (SNK_DL 130 / SNK_DIFF 130 / SNK lt. Tarif blank).
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  let ws = makeRow(R, { 50: 10, 51: '758.66', 52: '130', 53: '53.36', 54: '76.64', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), 'Wartezeit 2h á 65 EUR, ok?');
  ws = makeRow(R, { 50: 10, 52: '130', 53: '130', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), 'Wartezeit 2h á 65 EUR, ok?');
});

test('processDachser: SNK_DL=130 outside K1AV -> Standgeld', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '130', 53: '60', 54: '70', 55: 'DA01' });
  assert.equal(e.processDachser(ws, R, cols), 'Standgeld');
});

test('processDachser: SNK_DL=210 K1AV -> admin fee + Speditionskosten + 2h waiting time', () => {
  // Bundle 2026-10-19 row 252: 210 = 130 (2 x 65 waiting time) + 75
  // (Speditionskosten gem. Text) + 5 (admin/fenster fee), named in that order.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '871.24', 52: '210', 53: '125.51', 54: '84.49', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols),
    'Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag // Speditionskosten gem. Text // Wartezeit 2h á 65 EUR, ok?');
});

test('processDachser: K1AV 2.Zustellung names SNK_DL when the SNK tariff is blank', () => {
  // Bundle 2026-10-19 row 22 (TARIF blank, SNK lt. Tarif blank): the 5 EUR admin
  // deduction must not apply, the auditor names the amount as billed.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55, sachkonto: 35 };
  const ws = makeRow(R, { 50: 10, 52: '931.15', 53: '931.15', 55: 'K1AV', 35: '612100' });
  assert.equal(e.processDachser(ws, R, cols), '931,15 Kosten für 2.Zustellung etc. ok?');
});

test('processDachser: K1AV 2.Zustellung names SNK_DL when the SNK tariff equals TARIF', () => {
  // Bundle 2026-10-19 row 155: SNK lt. Tarif 53.55 == TARIF 53.55, so SNK_DL is
  // the bundle itself and not a Laderaum base with a fee on top.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55, sachkonto: 35 };
  const ws = makeRow(R, { 50: 10, 51: '53.55', 52: '1163.45', 53: '1109.9', 54: '53.55', 55: 'K1AV', 35: '612100' });
  assert.equal(e.processDachser(ws, R, cols), '1163,45 Kosten für 2.Zustellung etc. ok?');
});

test('processDachser: an integer 2.Zustellung amount renders without cents', () => {
  // Bundle 2026-10-19 row 23: SNK_DL 921, TARIF and SNK lt. Tarif blank. The
  // truth cell reads "921 Kosten für ...", not "921,00" (and not
  // Laderaumkostenentwicklung, which is where the residual chain used to end).
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55, sachkonto: 35 };
  const ws = makeRow(R, { 50: 10, 52: '921', 53: '921', 55: 'K1AV', 35: '612100' });
  assert.equal(e.processDachser(ws, R, cols), '921 Kosten für 2.Zustellung etc. ok?');
  assert.equal(e.phraseToKey('921 Kosten für 2.Zustellung etc. ok?'), 'tpl_zustellungKosten');
});

test('processDachser: K1AV SNK_DL 500 exactly stays Laderaumkostenentwicklung', () => {
  // The >500 branch is strict: 500 sits on the bound, not over it, so the row
  // must not read a 2.Zustellung amount.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55, sachkonto: 35 };
  const ws = makeRow(R, { 50: 10, 52: '500', 53: '500', 55: 'K1AV', 35: '612100' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Laderaumkostenentwicklung');
});

test('processDachser: K1AV SNK_DL 500.5 names the cents-bearing amount', () => {
  // Just over the bound with cents: the amount is billed as-is, no admin
  // deduction, and the cents survive the German formatting.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55, sachkonto: 35 };
  const ws = makeRow(R, { 50: 10, 52: '500.5', 53: '500.5', 55: 'K1AV', 35: '612100' });
  assert.equal(e.processDachser(ws, R, cols), '500,50 Kosten für 2.Zustellung etc. ok?');
});

test('processDachser: all DL cost lines zero with three negative deltas -> zusammengefasste Abrechnung', () => {
  // Bundle 2026-10-19 rows 327 (DA07, EXP -30, SNK -2.17) and 377 (DA01, SBFU -1,
  // SNK -2.28): FR, MT and TZ all short, both volume columns 0, so the invoice
  // billed the shipment together with another one.
  const cols = { stat: 50, tarif: 51, fr: 52, exp: 53, maut: 54, tz: 55, sbfu: 56,
                 snk_dl: 57, snk_diff: 58, snk_tar: 59, vkg: 60, vkg_dl: 61, serv_art: 62, sachkonto: 35 };
  let ws = makeRow(R, { 50: 10, 51: '86.2', 52: '-43.44', 53: '-30', 54: '-1.77', 55: '-7.82',
    56: '-1', 58: '-2.17', 59: '2.17', 60: '0', 61: '0', 62: 'DA07', 35: '' });
  assert.equal(e.processDachser(ws, R, cols), 'zusammengefasste Abrechnung');
  ws = makeRow(R, { 50: 10, 51: '53.03', 52: '-45.64', 54: '-3.55', 55: '-8.22',
    56: '-1', 58: '-2.28', 59: '2.28', 60: '0', 61: '0', 62: 'DA01' });
  assert.equal(e.processDachser(ws, R, cols), 'zusammengefasste Abrechnung');
});

test('processDachser: a DL weight on the row keeps the ordinary cascade', () => {
  // Row 377 with Volumen kg DL 1828: the row does carry a DL cost basis, so the
  // combined-invoice gate must not fire and the cascade speaks as before.
  const cols = { stat: 50, tarif: 51, fr: 52, maut: 53, tz: 54, sbfu: 55,
                 snk_dl: 56, snk_diff: 57, snk_tar: 58, vkg: 59, vkg_dl: 60, serv_art: 61 };
  const ws = makeRow(R, { 50: 10, 51: '53.03', 52: '-45.64', 53: '-3.55', 54: '-8.22',
    55: '-1', 57: '-2.28', 58: '2.28', 59: '0', 60: '1828', 61: 'DA01' });
  assert.equal(e.processDachser(ws, R, cols),
    'Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag // Mautdifferenz // SBfU-Bescheinigung f. Umsatzsteuerzwecke // Differenz Frachtzu/ abschlag');
});

test('processDachser: SNK_DL=75 K1AV stays Speditionskosten gem. Text', () => {
  // The 75-code branch returns before the residual logic; a bundled residual of
  // 70 must not be mistaken for waiting time.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '200', 52: '75', 53: '75', 54: '', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), 'Speditionskosten gem. Text');
});

test('processDachser: non-integer SNK_DL with an integer residual -> Laderaumkostenentwicklung', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53 };
  const ws = makeRow(R, { 50: 10, 51: '600.72', 52: '16.29', 53: '-13' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Laderaumkostenentwicklung');
});

test('processDachser: import-lane SNK_DL=5 with a delta -> Laderaumkostenentwicklung', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, abg_land: 54, empf_land: 55 };
  const ws = makeRow(R, { 50: 10, 51: '140.84', 52: '5', 53: '0.15', 54: 'FR', 55: 'DE' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Laderaumkostenentwicklung');
});

test('processDachser: domestic SNK_DL=5 with a delta keeps the automatic-ZTV note', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, abg_land: 54, empf_land: 55 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '5', 53: '2.62', 54: 'DE', 55: 'DE' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Automatische Zustellterminvereinbarung - Laderaumzuschlag');
});

test('processDachser: 196 Differenz over threshold -> "Kalk. Kosten Zustellung" leads the note', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, abg_land: 55, empf_land: 56,
                 fr_dl: 57, fr_tar: 58, exp: 59, exp_dl: 60, maut: 61, tz: 62,
                 snk_dl: 63, snk_diff: 64, snk_tar: 65, c196_diff: 66 };
  const ws = makeRow(R, { 3: '1', 50: 10, 51: '97.12', 52: '2.12', 53: '184', 54: '184',
    55: 'DE', 56: 'PL', 57: '71', 58: '68.88', 59: '10', 60: '10', 61: '-2.72', 62: '0.38',
    63: '3.55', 64: '0.11', 65: '3.44', 66: '110' });
  assert.equal(e.processDachser(ws, R, cols),
    'Kalk. Kosten Zustellung // Differenz Laderaumkostenentwicklung // Produktzuschlag // Mautdifferenz // Dachser berechnet die Kosten nach dem bisherigen Tarif');
  assert.equal(e.processDachser(makeRow(R, { 50: 10, 51: '100', 66: '0.08' }),
    R, { stat: 50, tarif: 51, c196_diff: 66 }), '', 'the 0.08 boundary must stay silent');
});

test('phraseToKey: computed Dachser SNK phrases resolve to their template keys', () => {
  assert.equal(e.phraseToKey('Wartezeit 2h á 65 EUR, ok?'), 'tpl_wartezeit');
  assert.equal(e.phraseToKey('Wartezeit 12h á 65 EUR, ok?'), 'tpl_wartezeit');
  assert.equal(e.phraseToKey('931,15 Kosten für 2.Zustellung etc. ok?'), 'tpl_zustellungKosten');
  assert.equal(e.phraseToKey('1200,50 Kosten für 2.Zustellung etc. ok?'), 'tpl_zustellungKosten');
  // An integer amount has no cents, and the auditor still writes it in the same
  // shape (bundle 2026-10-19 row 23: SNK_DL 921, truth "921 Kosten für ...").
  assert.equal(e.phraseToKey('921 Kosten für 2.Zustellung etc. ok?'), 'tpl_zustellungKosten');
});

test('processDachser: equal weights with positive FR above 0.08 and no other triggers -> Frachtdifferenz', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54 };
  const ws = makeRow(R, { 50: 10, 51: '914.23', 52: '0.1', 53: '9550', 54: '9550' });
  assert.equal(e.processDachser(ws, R, cols), 'Frachtdifferenz');
});

test('processDachser: equal weights + positive FR on an international lane -> bisherigen Tarif note', () => {
  // Bundle 2026-09-18 rows 57b40b11…7fc66527 (RS/CH→DE imports and DE→PL exports):
  // when the origin or destination is non-DE, a positive FR delta at equal weights
  // is the auditor's "Dachser bills at the previous tariff" note, not a weight miscalc.
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, abg_land: 55, empf_land: 56 };
  let ws = makeRow(R, { 50: 10, 51: '538.1', 52: '17.05', 53: '566', 54: '566', 55: 'RS', 56: 'DE' });
  assert.equal(
    e.processDachser(ws, R, cols),
    'Dachser berechnet die Kosten nach dem bisherigen Tarif',
    'RS→DE import, equal weights',
  );
  ws = makeRow(R, { 50: 10, 51: '207.51', 52: '1.93', 53: '148', 54: '148', 55: 'DE', 56: 'PL' });
  assert.equal(
    e.processDachser(ws, R, cols),
    'Dachser berechnet die Kosten nach dem bisherigen Tarif',
    'DE→PL export, equal weights',
  );
});

test('processDachser: equal weights + positive FR stays Frachtdifferenz on a domestic lane', () => {
  // The 2026-09-04 workbook regressed ~44 domestic equal-weight rows as
  // "Frachtdifferenz"; the intl-lane gate must not touch those.
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, abg_land: 55, empf_land: 56 };
  const ws = makeRow(R, { 50: 10, 51: '914.23', 52: '0.1', 53: '9550', 54: '9550', 55: 'DE', 56: 'DE' });
  assert.equal(e.processDachser(ws, R, cols), 'Frachtdifferenz');
});

test('processDachser: equal weights with negative FR < -1.0 and no other triggers -> abweichender Gewichte', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54 };
  const ws = makeRow(R, { 50: 10, 51: '108.4', 52: '-11.1', 53: '445', 54: '445' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz aufgrund abweichender Gewichte');
});

test('processDachser: weights differ but in same tier with positive FR -> Frachtdifferenz', () => {
  // brutto=120, vkg_dl=140 are both in tier 150 (DACHSER_BP breakpoint 150)
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '15.50', 53: '120', 54: '140' });
  assert.equal(e.processDachser(ws, R, cols), 'Frachtdifferenz');
});

test('processDachser: weights differ but small positive FR delta (< 1.0) -> Frachtdifferenz', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg: 54, vkg_dl: 55 };
  const ws = makeRow(R, { 50: 10, 51: '73.31', 52: '0.09', 53: '194', 54: '194', 55: '109' });
  assert.equal(e.processDachser(ws, R, cols), 'Frachtdifferenz');
});

test('processDachser: sub-kilo weight gap inside one tier -> abweichender Gewichte', () => {
  // Bundle 2026-10-19 row 411: Brutto 68.533 vs Volumen kg DL 68 (both tier 100),
  // FR 0.56. The weights disagree by more than rounding, so the auditor names the
  // weight even though the tier table prices the two the same.
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, tz: 55, serv_art: 56, sachkonto: 35 };
  const ws = makeRow(R, { 50: 10, 51: '57.41', 52: '0.56', 53: '68.533', 54: '68', 55: '0.1', 56: 'DA01', 35: 'X' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz aufgrund abweichender Gewichte');
});

test('processDachser: a weight gap under 0.05 kg on the same tier keeps Frachtdifferenz', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54 };
  const ws = makeRow(R, { 50: 10, 51: '57.41', 52: '0.56', 53: '68.53', 54: '68.5' });
  assert.equal(e.processDachser(ws, R, cols), 'Frachtdifferenz');
});

test('processDachser: blank TARIF + FR on inbound shipment from foreign Abg.-Land -> kein Tarif für <Land>', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, maut: 53, tz: 54, abg_land: 55 };
  const ws = makeRow(R, { 50: 10, 52: '958.8', 53: '64.89', 54: '91.71', 55: 'PT' });
  assert.equal(e.processDachser(ws, R, cols), 'kein Tarif für PT');
});

test('processDachser: blank TARIF + FR on outbound shipment to foreign Empf.-Land -> kein Tarif für <Land>', () => {
  // Bundle 2026-09-18 row 646ef434 (DE→RO, TARIF blank, FR=1783.7, SACH+SERV set):
  // the missing tarif is the destination country's, so the note names RO instead
  // of falling through to the Fremdnummer literal.
  const cols = { stat: 50, tarif: 51, fr: 52, maut: 53, tz: 54, abg_land: 55, empf_land: 56, sachkonto: 57, serv_art: 58 };
  const ws = makeRow(R, { 50: 10, 52: '1783.7', 53: '47.47', 54: '276.47', 55: 'DE', 56: 'RO', 57: '612110', 58: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), 'kein Tarif für RO');
});

test('processDachser: blank TARIF + FR with SERV/SACH -> Fremdnummer already-billed note', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, referenz: 53 };
  // SERV_ART=16, SACHKONTO=35 populated => the "already billed in another Beleg" branch.
  // The auditor names the row's OWN ReferenzNr, so the branch interpolates it (bundle v3
  // row 510cb3ab / ground-truth row 193, ReferenzNr=2544567001).
  const ws = makeRow(R, { 50: 10, 51: '', 52: '47.2', 16: 'DA01', 35: '612100', 53: '2544567001' });
  assert.equal(e.processDachser(ws, R, cols), 'Fremdnummer 2544567001 bereits berechnet in RE00123xxx, ok?');
});

test('processDachser: Fremdnummer note keeps the placeholder when the row has no ReferenzNr', () => {
  // The Beleg the row was "already billed in" names a document that is not in this
  // workbook, so it stays a placeholder either way. The Fremdnummer end is the row's own
  // cell: with that cell empty there is nothing to interpolate, and the note must still
  // carry the original template wording rather than an empty slot.
  const cols = { stat: 50, tarif: 51, fr: 52, referenz: 53 };
  const ws = makeRow(R, { 50: 10, 51: '', 52: '47.2', 16: 'DA01', 35: '612100' });
  assert.equal(e.processDachser(ws, R, cols), 'Fremdnummer 5034xxx bereits berechnet in RE00123xxx, ok?');
});

test('processDachser: Fremdnummer note trims the ReferenzNr cell', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, referenz: 53 };
  const ws = makeRow(R, { 50: 10, 51: '', 52: '75', 16: 'K1AV', 35: '612100', 53: '  2544567001  ' });
  assert.equal(e.processDachser(ws, R, cols), 'Fremdnummer 2544567001 bereits berechnet in RE00123xxx, ok?');
});

test('processDachser: EXP_DL=95 -> Terminzuschlag (no hyphen, matches auditor truth)', () => {
  // Bundle 2026-06-29 rows d3d916e9 / 021da4b8 / 43ef18f0: EXP=95, EXP_DL=95 → the
  // auditor writes "Terminzuschlag" as one word, not the old hyphenated "Termin-zuschlag".
  const cols = { stat: 50, tarif: 51, exp: 52, exp_dl: 53 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 95, 53: 95 });
  assert.equal(e.processDachser(ws, R, cols), 'Terminzuschlag');
});

test('processDachser: ZW row with Anz.Sdg>1 -> bundling wins over the Zwischenempfänger note', () => {
  // Bundle 2026-06-29 rows 289deb46 / 5998e21f: REFERENZ3=ZW but Anz.Sdg=2 → the
  // auditor's finding is "hätte gebündelt werden können?", not the ZW note.
  const cols = { stat: 50, tarif: 51, fr: 52 };
  // REFERENZ3=15 'ZW', ANZ_SDG=3 = 2, EMPF_PLZ=13 / EMPF_ORT=14 set to prove the ZW
  // note (which would interpolate them) is NOT emitted.
  const ws = makeRow(R, { 50: 10, 51: '200', 52: '75.03', 15: 'ZW', 3: '2', 13: '75012', 14: 'Paris' });
  assert.equal(e.processDachser(ws, R, cols), 'hätte gebündelt werden können?');
});

test('processDachser: single-shipment ZW row still emits the Zwischenempfänger note', () => {
  // Guard the reorder: with Anz.Sdg=1 the ZW branch is preserved (bundle row f278b340).
  const cols = { stat: 50, tarif: 51, fr: 52 };
  const ws = makeRow(R, { 50: 10, 51: '200', 52: '102.4', 15: 'ZW', 3: '1', 13: '75737', 14: 'PARIS CEDEX 15' });
  assert.equal(
    e.processDachser(ws, R, cols),
    'Differenz aufgrund abweichender Zwischenempfänger 75737 PARIS CEDEX 15',
  );
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

test('processDachser: 2026-08-31 Dachser bundle signatures', () => {
  const cols = {
    stat: 50, tarif: 51, fr: 52, vkg: 53, vkg_dl: 54, snk_dl: 55,
    snk_diff: 56, snk_tar: 57, exp: 58, exp_dl: 59, maut: 60, zz: 61,
    empf_plz: 62, empf_ort: 63, anz_sdg: 64, serv_art: 65, sachkonto: 66,
  };

  let ws = makeRow(R, { 50: 10, 51: 48.07, 52: 4.5, 53: 88, 54: 88, 55: 3.82, 56: 1.87, 57: 1.95, 58: 10, 59: 10, 62: '60325', 63: 'FRANKFURT', 64: 1 });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Laderaumkostenentwicklung // Produktzuschlag // Frachtdifferenz');

  ws = makeRow(R, { 50: 10, 51: 37.05, 52: 4.9, 53: 34, 54: 34, 55: 3.07, 56: 1.57, 57: 1.5, 58: 10, 59: 10, 61: 35, 62: '50354', 63: 'HUERTH', 64: 1 });
  assert.equal(e.processDachser(ws, R, cols), '2. Zustellung // Differenz Laderaumkostenentwicklung // Produktzuschlag // Fracht Differenz');

  ws = makeRow(R, { 50: 10, 51: 170.9, 53: 0, 54: 201, 55: 6.32, 57: 6.32, 60: -9.83, 62: 'WC2B 4AN', 63: 'LONDON', 64: 1 });
  assert.equal(e.processDachser(ws, R, cols), 'Mautdifferenz // Zone korrekt berechnet? // Einfuhrzollabfertigung');

  /* 2026-07-30 row 70 (K1AU, DE->PL, Anz.Sdg=1): the rate card matches an
     add-on S=180 (248.9-180=68.90 vs NEW PL1 68.81), but the row's own FR
     delta is 90.02, so the K1AU ratecard gate must not fire and the doppelt90
     fallback stands. The lanes and weights are supplied so the ratecard path
     actually runs (the shared cols leave cc='' and never reach it). */
  const cols70 = { ...cols, fr_dl: 67, fr_tar: 68, abg_land: 69, empf_land: 70, brutto: 71 };
  ws = makeRow(R, { 50: 10, 51: 194.43, 52: 90.02, 53: 0, 54: 173, 55: 3.45, 56: 3.45, 58: 40, 59: 50, 60: -7.64, 62: '02-495', 63: 'Warszawa', 64: 1, 65: 'K1AU', 66: '612110', 67: 248.9, 68: 158.88, 69: 'DE', 70: 'PL', 71: 173 });
  assert.equal(e.processDachser(ws, R, cols70), 'Differenz Laderaumkostenentwicklung // Produktzuschlag // Mautdifferenz // "Sonderfahrt" 90 EUR doppelt berechnet?');

  // Bundle 2026-09-01: Admin Zeitfensterbuchung Handel - Laderaumzuschlag (with hyphen)
  ws = makeRow(R, { 50: 10, 51: 666.43, 54: 1594, 55: 5, 56: -65.84, 57: 70.84, 62: '59368', 63: 'Werne', 64: 1, 65: 'K1AV', 66: '612100' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag');

  // Bundle 2026-09-01: 38L Differenz -> Maut von/bis NL
  const colsWith38L = { ...cols, tz: 67, c38l_diff: 68 };
  ws = makeRow(R, { 50: 10, 51: 600.03, 52: 70.16, 53: 1536, 54: 1451, 55: 23.41, 56: 3.06, 57: 20.35, 58: 46.8, 59: 46.8, 62: '73312', 63: 'GEISLINGEN AN DER STEIGE', 64: 1, 67: 6.71, 68: 14.51 });
  assert.equal(e.processDachser(ws, R, colsWith38L), 'Differenz Laderaumkostenentwicklung // Produktzuschlag // Differenz aufgrund abweichender Gewichte // Maut von/bis NL');
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

test('processKN: blank cost-centre / account stays silent while KONTIERUNG_ENABLED is false', () => {
  // KONTIERUNG_ENABLED=false (engine default since the flag was introduced) suppresses the
  // Kontierung? byproduct everywhere; re-enable the flag and this row reads "Kontierung?" again.
  const ws = makeRow(R, { 50: 10, 51: '100' }); // kost/sach blank
  assert.equal(e.processKN(ws, R, KN_COLS), '');
});

/* ──────────────────────────────────────────────────────────
   DHL EXPRESS
─────────────────────────────────────────────────────────── */
const DHL_COLS = {
  stat: 50, tarif: 51, sach: 52, kost: 53, addr: 54, stack: 55, weight: 56,
  conv: 57, irr: 58, neut: 59, sign: 60, snk: 61, diff: 62, maut: 63, surc: 64, over: 65, tz: 66, el: 67,
};

test('processDHL: STAT != 10 returns null', () => {
  const ws = makeRow(R, { 50: 7 });
  assert.equal(e.processDHL(ws, R, DHL_COLS), null);
});

test('processDHL: zero tariff with text -> templated Fremdnummer-already-billed query', () => {
  // 4d3b4ad turned the flat "Fremdnummer doppelt berechnet." into a template that names the
  // other consignment ("berechnet in <Beleg>, ok?"); with no references on the row the
  // placeholders render as xxx.
  const ws = makeRow(R, { 50: 10, 51: '0' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'Fremdnummer xxx bereits berechnet in RExxx, ok?.');
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

test('processDHL: EL delta -> "EXTENDED LIABILITY, ok?"', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 'S', 53: 'K', 67: '5' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'EXTENDED LIABILITY, ok?');
});

test('processDHL: EL + SNK 5 -> extended liability then direct signature', () => {
  // 2026-10-02 bundle rows 36c5deda/cf557f1b: EL=2 and SNK=5 together, truth names both.
  const ws = makeRow(R, { 50: 10, 51: '12.74', 52: 'S', 53: 'K', 61: '5', 67: '2' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'EXTENDED LIABILITY, ok? // DIRECT SIGNATURE , ok?');
});

test('processDHL: SNK 5 alone -> "DIRECT SIGNATURE , ok?" (not a generic SNK gap)', () => {
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 'S', 53: 'K', 61: '5' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'DIRECT SIGNATURE , ok?');
});

test('processDHL: OW delta -> "Differenz overweight, ok?" (not the retired "overweight ok?")', () => {
  // 2026-10-02 bundle rows f0c1a051/1f20e6ce.
  const ws = makeRow(R, { 50: 10, 51: '100', 52: 'S', 53: 'K', 56: '30' });
  assert.equal(e.processDHL(ws, R, DHL_COLS), 'Differenz overweight, ok?');
});

/* ──────────────────────────────────────────────────────────
   WACKLER
─────────────────────────────────────────────────────────── */
const W_COLS = {
  target: 50, stat: 51, tarif: 52, avis_diff: 53, snk_diff: 54, fr: 55, maut: 56,
  tz: 57, referenz: 58, vkg: 59, vkg_dl: 60, empf_plz: 61, empf_ort: 62,
  kostenstelle: 63, sachkonto: 64, zone: 65, empf_land: 66, abg_land: 67, abg_plz: 68,
  fr_tar: 69, fr_dl: 70, colli: 71, brutto: 72, tz_dl: 73, tz_tar: 74,
};

/* Rule 2c calls a row flat freight only when MT, SNK, TZ and AVIS are all exactly zero, so the
   cascade fixtures below carry the fuel spill 89 of the 90 released FR rows have, about 9% of
   the freight delta (13% on the 10369566 return rows; 10361841 row 11: FR -10.44 / TZ -0.94).
   The lone exception is 10369563 row 32 (TZ blank), the flat-freight row rule 2c exists to claim.
   Rule 2b peels the 250 € Zusatzkosten off the same FR-only shape first. */

test('processWackler: existing annotation is ignored — output recomputed from inputs', () => {
  // target cell already holds a phrase, but the engine never preserves it:
  // VKG=120 and VKG_DL=130 both fall in the 150 kg bucket -> same-tier wording,
  // proving the pre-existing "Differenz aufgrund abweichender Gewichte" is discarded.
  const ws = makeRow(R, {
    50: 'Differenz aufgrund abweichender Gewichte',
    51: 10, 52: '100', 55: '5', 57: '0.45', 59: '120', 60: '130', 63: '1', 64: '2',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Wackler rechnet Frachtrate für 150kg ab');
});

test('processWackler: STAT != 10 with blank KOST/SACH -> null (Kontierung? flag-gated off)', () => {
  // The STAT!=10 early path used to end in "Kontierung?"; with KONTIERUNG_ENABLED=false the
  // blank KOST/SACH branch contributes nothing and the row stays unannotated.
  const ws = makeRow(R, { 51: 5 }); // stat != 10, kost/sach blank
  assert.equal(e.processWackler(ws, R, W_COLS), null);
});

test('processWackler: STAT != 10 with filled KOST/SACH -> null', () => {
  const ws = makeRow(R, { 51: 5, 63: '12', 64: '34' });
  assert.equal(e.processWackler(ws, R, W_COLS), null);
});

test('processWackler: dash tariff -> templated Fremdnummer-already-billed query', () => {
  const ws = makeRow(R, { 51: 10, 52: '-', 63: '12', 64: '34' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Fremdnummer xxx bereits berechnet in RExxx, ok?');
});

test('processWackler: dash tariff + blank KOST/SACH -> Fremdnummer query only (no Kontierung?)', () => {
  // Kontierung? is gated behind KONTIERUNG_ENABLED=false, so the blank KOST/SACH byproduct
  // no longer joins the Fremdnummer query.
  const ws = makeRow(R, { 51: 10, 52: '-' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Fremdnummer xxx bereits berechnet in RExxx, ok?');
});

test('processWackler: the Fremdnummer note names its own ReferenzNr (D7)', () => {
  // D7: the cited invoice is cross-workbook, so RExxx stays a placeholder; the ref does not.
  const one = makeRow(R, { 51: 10, 52: '', 55: '282.23', 58: '2545058028' });
  assert.equal(e.processWackler(one, R, W_COLS),
    'Fremdnummer 2545058028 bereits berechnet in RExxx, ok?');
  // A multi-ref cell interpolates its first token only (10370017 row 18 shape).
  const many = makeRow(R, { 51: 10, 52: '', 55: '282.23', 58: '2544983744,2544976646' });
  assert.equal(e.processWackler(many, R, W_COLS),
    'Fremdnummer 2544983744 bereits berechnet in RExxx, ok?');
});

test('processWackler: a "-" ReferenzNr is blank, not interpolated (D7)', () => {
  // The sheet writes '-' where it has no reference; interpolating it would read
  // 'Fremdnummer - bereits ...', naming a reference the row does not have.
  const dash = makeRow(R, { 51: 10, 52: '', 55: '282.23', 58: '-' });
  const dashOut = e.processWackler(dash, R, W_COLS);
  assert.equal(dashOut, 'Fremdnummer xxx bereits berechnet in RExxx, ok?');
  assert.deepEqual(Array.from(e.phraseKeysFor(e.splitTriggers(dashOut))), ['fremdnummer']);
  // A blank cell keeps the same literal and the same key.
  const blank = makeRow(R, { 51: 10, 52: '', 55: '282.23', 58: '' });
  const blankOut = e.processWackler(blank, R, W_COLS);
  assert.equal(blankOut, 'Fremdnummer xxx bereits berechnet in RExxx, ok?');
  assert.deepEqual(Array.from(e.phraseKeysFor(e.splitTriggers(blankOut))), ['fremdnummer']);
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
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '5', 57: '0.45', 59: '120', 60: '130', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Wackler rechnet Frachtrate für 150kg ab');
});

test('processWackler: cross-tier weights + FR -> Differenz aufgrund abweichender Gewichte', () => {
  // VKG=120 (tier 150) vs VKG_DL=400 (tier 400) fall in different rate buckets
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '5', 57: '0.45', 59: '120', 60: '400', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz aufgrund abweichender Gewichte');
});

test('processWackler: 7+ Colli cascade judges on the REAL weights, names tiers via the pallet-volume synthetic', () => {
  // v1.38.0: for colli>=7 the chargeable weight max(Colli*285, Volumen, Brutto) is a SYNTHETIC
  // pallet-volume estimate — right for NAMING the tier, wrong for deciding the finding. The
  // cascade now reads the finding off VKG vs VKG_DL and the reference count:
  //   VKG / VKG_DL in different tiers           -> Differenz aufgrund abweichender Gewichte
  //   multi-ref, weights 1-5% apart             -> hätte gebündelt werden müssen
  //   same tier, >= 6 references                -> hätte gebündelt werden müssen
  //   pallet volume outruns VKG, tiers apart    -> Differenz aufgrund abweichender Gewichte
  //   otherwise                                 -> Wackler rechnet Frachtrate für <tier>kg ab

  // Different REAL-weight tiers (VKG 1200 vs DL 1950/2200/2350) -> weight discrepancy, even
  // though the synthetic pallet volume (7×285=1995) once steered these to "rechnet 2000kg".
  let ws = makeRow(R, { 51: 10, 52: 100, 55: 5, 57: 0.45, 59: 1200, 60: 1950, 63: 1, 64: 2, 71: 7, 72: 1500 });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz aufgrund abweichender Gewichte');

  ws = makeRow(R, { 51: 10, 52: 100, 55: 5, 57: 0.45, 59: 1200, 60: 2200, 63: 1, 64: 2, 71: 7, 72: 1500 });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz aufgrund abweichender Gewichte');

  ws = makeRow(R, { 51: 10, 52: 100, 55: 5, 57: 0.45, 59: 1200, 60: 2350, 63: 1, 64: 2, 71: 7, 72: 2300 });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz aufgrund abweichender Gewichte');

  // Same real-weight tier (2500/2550 -> 2600), single reference, no other signal -> Wackler
  // simply billed that tier's rate; the note names the tier of the synthetic chargeable weight.
  ws = makeRow(R, { 51: 10, 52: 100, 55: 5, 57: 0.45, 59: 2500, 60: 2550, 63: 1, 64: 2, 71: 7, 72: 1500 });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Wackler rechnet Frachtrate für 2600kg ab');

  // MT stays additive on a positive-FR "rechnet" row (fuel itemised, not absorbed).
  ws = makeRow(R, { 51: 10, 52: 100, 55: 5, 56: 3, 59: 2500, 60: 2550, 63: 1, 64: 2, 71: 7, 72: 1500 });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 2600kg ab // Mautdifferenz'
  );
});

test('processWackler: 7+ Colli, same tier, >= 6 references -> hätte gebündelt werden müssen', () => {
  // At six references the row is unambiguously several consignments on one booking
  // (AI-bundle 97181c3c 8 refs / a0405b05 6 refs), regardless of how closely the weights agree.
  const ws = makeRow(R, {
    51: 10, 52: 100, 55: 5, 57: 0.45, 58: 'r1,r2,r3,r4,r5,r6',
    59: 1200, 60: 1200, 63: 1, 64: 2, 71: 7, 72: 1500,
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: 7+ Colli, multi-ref weights within the near-band -> hätte gebündelt werden müssen', () => {
  // Separate consignments whose weights sit 1-5% apart should have ridden one booking, whether
  // or not the two weights share a tier (AI-bundle 6756eaf6 2.3% / fa79ebc2 2.2% / 5e168bd5 2.8%).
  // VKG 1000 vs VKG_DL 1023 cross tiers, so only the near-band branch can produce the finding.
  const ws = makeRow(R, {
    51: 10, 52: 100, 55: 5, 57: 0.45, 58: 'r1,r2',
    59: 1000, 60: 1023, 63: 1, 64: 2, 71: 8, 72: 1200,
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: 7+ Colli, pallet volume materially outruns the declared volume weight', () => {
  // colli*285 (1995) far exceeds VKG=VKG_DL=980 and the synthetic volume tier (2000) sits above
  // the declared tier (1000): the pallet space is the true chargeable weight and the DL billed a
  // lower one -> weight discrepancy (AI-bundle ec7eb2d5 1995 vs 980).
  const ws = makeRow(R, { 51: 10, 52: 100, 55: 5, 57: 0.45, 59: 980, 60: 980, 63: 1, 64: 2, 71: 7 });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz aufgrund abweichender Gewichte');
});

test('processWackler: FR delta plus a sub-threshold TZ, no weights -> Frachtdifferenz', () => {
  // TZ 0.45 is below WACKLER_TZ_ADDITIVE and that is the only reason this shape escapes rule 2c,
  // which demands TZ exactly zero, so the freight fallback labels the bare freight delta.
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '5', 57: '0.45', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Frachtdifferenz');
});

test('processWackler: blank KOST/SACH only stays silent while KONTIERUNG_ENABLED is false', () => {
  const ws = makeRow(R, { 51: 10, 52: '100' });
  assert.equal(e.processWackler(ws, R, W_COLS), '');
});

test('processWackler: standalone fuel (no FR/MT delta) -> "Differenz treibstoff"', () => {
  // 10369563 row 8 (FR 0, MT 0, TZ 4.59) is the corpus's only standalone fuel row: no
  // freight or toll phrase rides on it, so the auditor names the fuel itself.
  const ws = makeRow(R, { 51: 10, 52: '100', 57: '5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz treibstoff');
});

test('processWackler: a row delivered to the Riedlingen return hub reads "Return, ok?" alone', () => {
  // 10369566 row 6: FR 80.19, MT 6.96, TZ 10.42 all read as findings until the row is
  // recognised as a return; the truth cell carries the Return phrase and nothing else.
  const ws = makeRow(R, {
    51: 10, 52: '152.28', 55: '80.19', 56: '6.96', 57: '10.42', 58: '26381853',
    59: '1500', 60: '1500', 61: '88499', 62: 'RIEDLINGEN', 63: '211FO998', 64: '612100',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Return, ok?');
});

test('processWackler: the return branch needs the exact 88499 / RIEDLINGEN pair', () => {
  const cells = {
    51: 10, 52: '152.28', 55: '80.19', 56: '6.96', 57: '10.42', 58: '26381853',
    59: '1500', 60: '1500', 63: '211FO998', 64: '612100', 71: '8', 72: '1500',
  };
  const out = 'Differenz aufgrund abweichender Gewichte // Mautdifferenz // Differenz Energiezuschlag';
  assert.equal(e.processWackler(makeRow(R, { ...cells, 61: '88498', 62: 'RIEDLINGEN' }), R, W_COLS), out);
  assert.equal(e.processWackler(makeRow(R, { ...cells, 61: '88499', 62: 'RIEDLINGENX' }), R, W_COLS), out);
});

test('processWackler: FR is the only cost delta -> "Pauschalfracht, ok?" (10369563 row 32)', () => {
  // 10369563 row 32 is the one released row whose only cost delta is the freight: FR 538.16
  // against a 156.84 tariff, MT/SNK/TZ/AVIS all blank. Owner ruling 2026-10-21: "only FR always
  // Pauschalfracht".
  const ws = makeRow(R, {
    51: 10, 52: '156.84', 55: '538.16', 58: 'r1,r2,r3,r4,r5,r6,r7,r8,r9,r10',
    59: '1034', 60: '1034', 63: 'X', 64: 'X', 69: '156.84', 70: '695', 71: '10', 72: '1034',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Pauschalfracht, ok?');
});

test('processWackler: a return row wins over the flat-freight arm', () => {
  // Same flat-freight shape (10369563 row 32), delivered to the Riedlingen return hub. The
  // return branch runs before rule 2c, so the freight arm cannot claim the row.
  const ws = makeRow(R, {
    51: 10, 52: '156.84', 55: '538.16', 58: 'r1,r2,r3,r4,r5,r6,r7,r8,r9,r10',
    59: '1034', 60: '1034', 61: '88499', 62: 'RIEDLINGEN', 63: 'X', 64: 'X',
    69: '156.84', 70: '695', 71: '10', 72: '1034',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Return, ok?');
});

test('processWackler: an FR delta with a TZ delta keeps the rate-card note (10361841 row 11)', () => {
  // 1 ref, 389/389 kg, FR -10.44 with TZ -0.94 (9% of FR): the freight is not the only cost
  // delta, so rule 2c stays off and the weight cascade names the tier. The row's SNK -0.04 is
  // left out so the TZ term is the one this test exercises.
  const ws = makeRow(R, {
    51: 10, 52: '119.87', 55: '-10.44', 57: '-0.94', 58: '2544271490',
    59: '389', 60: '389', 63: '211FO002', 64: '612110', 69: '104.39', 70: '93.95',
    71: '2', 72: '389',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Wackler rechnet Frachtrate für 400kg ab');
});

test('processWackler: the FR-only shape ignores reference count and weight agreement', () => {
  // The old arm needed 2+ references and VKG === VKG_DL; neither condition is left, so the same
  // row 32 shape reads flat freight with one reference and with 560/140 kg.
  const base = {
    51: 10, 52: '261.14', 55: '1084.04', 63: '1', 64: '2', 69: '229.34', 70: '1313.38',
    71: '4', 72: '560',
  };
  assert.equal(e.processWackler(makeRow(R, { ...base, 58: 'a', 59: '560', 60: '140' }), R, W_COLS),
    'Pauschalfracht, ok?');
  assert.equal(e.processWackler(makeRow(R, { ...base, 58: 'a,b,c', 59: '560', 60: '140' }), R, W_COLS),
    'Pauschalfracht, ok?');
  assert.equal(e.processWackler(makeRow(R, { ...base, 58: 'a', 59: '1200', 60: '1200' }), R, W_COLS),
    'Pauschalfracht, ok?');
});

test('processWackler: an FR credit with every other block zero reads "Pauschalfracht, ok?"', () => {
  // "Only FR" is sign-agnostic: a freight credit that is the sole cost delta is the same
  // flat-rate reading as a charge.
  const ws = makeRow(R, {
    51: 10, 52: '32.07', 55: '-108.93', 58: 'a', 59: '100', 60: '100',
    63: '1', 64: '2', 69: '32.07', 70: '-76.86',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Pauschalfracht, ok?');
});

test('processWackler: an MT, TZ, SNK or AVIS signal keeps the flat-freight arm off', () => {
  // v1.56.0: the bundling finding is TERMINAL, so the four arms assert the same output — what
  // they still prove is that none of the deltas lets rule 2c claim the row as flat freight.
  const flat = {
    51: 10, 52: '156.84', 55: '538.16', 58: 'r1,r2,r3,r4,r5,r6,r7,r8,r9,r10',
    59: '1034', 60: '1034', 63: 'X', 64: 'X', 69: '156.84', 70: '695', 71: '10', 72: '1034',
  };
  assert.equal(e.processWackler(makeRow(R, { ...flat, 56: '5' }), R, W_COLS),
    'hätte gebündelt werden müssen');
  assert.equal(e.processWackler(makeRow(R, { ...flat, 57: '2.1' }), R, W_COLS),
    'hätte gebündelt werden müssen');
  assert.equal(e.processWackler(makeRow(R, { ...flat, 54: '6' }), R, W_COLS),
    'hätte gebündelt werden müssen');
  assert.equal(e.processWackler(makeRow(R, { ...flat, 53: '7.5' }), R, W_COLS),
    'hätte gebündelt werden müssen');
});

test('processWackler: FR + MT keeps the weight cascade (not flat freight)', () => {
  const ws = makeRow(R, {
    51: 10, 52: '156.84', 55: '538.16', 56: '5', 58: 'r1,r2,r3,r4,r5,r6,r7,r8,r9,r10',
    59: '1034', 60: '1034', 63: 'X', 64: 'X', 69: '156.84', 70: '695', 71: '10', 72: '1034',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: FR + SNK 6 keeps the weight cascade (not flat freight)', () => {
  const ws = makeRow(R, {
    51: 10, 52: '156.84', 54: '6', 55: '538.16', 58: 'r1,r2,r3,r4,r5,r6,r7,r8,r9,r10',
    59: '1034', 60: '1034', 63: 'X', 64: 'X', 69: '156.84', 70: '695', 71: '10', 72: '1034',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: FR + AVIS 7.5 keeps the weight cascade (not flat freight)', () => {
  const ws = makeRow(R, {
    51: 10, 52: '156.84', 53: '7.5', 55: '538.16', 58: 'r1,r2,r3,r4,r5,r6,r7,r8,r9,r10',
    59: '1034', 60: '1034', 63: 'X', 64: 'X', 69: '156.84', 70: '695', 71: '10', 72: '1034',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: fuel on an FR delta is suppressed when both sides carry the same rate (10362276 row 18)', () => {
  // 10362276 row 18: FR +22.19 with TZ +2.00. The fuel gap is the FR percentage trickling
  // through, and both sides carry the same rate here, so it is not a finding of its own.
  // v1.56.0 added the rate gate: both sides carry the SAME 9 % fuel rate (46.39/515.41 vs
  // 44.39/493.22), so the delta is derived and the fuel phrase is suppressed — the rate-card
  // note stands alone.
  const ws = makeRow(R, {
    51: 10, 52: '578.83', 54: '0.09', 55: '22.19', 57: '2', 58: 'a,b',
    59: '3135', 60: '3135', 63: '1', 64: '2', 69: '493.22', 70: '515.41', 71: '11', 72: '3135',
    73: '46.39', 74: '44.39',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Wackler rechnet Frachtrate für 3500kg ab');
});

test('processWackler: fuel riding on an MT delta keeps "Differenz Energiezuschlag"', () => {
  // No MT-only fuel row exists in the corpus (all 15 Energiezuschlag rows also carry FR),
  // so the toll branch follows the same rule as the freight branch.
  const ws = makeRow(R, { 51: 10, 52: '100', 56: '3', 57: '5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Mautdifferenz // Differenz Energiezuschlag');
});

test('processWackler: fuel with an SNK code keeps "Differenz Energiezuschlag"', () => {
  // SNK 43 (2.Zustellung) is a finding of its own, so the fuel gap is not the row's only one.
  const ws = makeRow(R, { 51: 10, 52: '100', 54: '43', 57: '5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS),
    '2.Zustellung ok? // Differenz Energiezuschlag');
});

test('processWackler: fuel with an AVIS code keeps "Differenz Energiezuschlag"', () => {
  const ws = makeRow(R, { 51: 10, 52: '100', 53: '7.5', 57: '5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Avis, ok? // Differenz Energiezuschlag');
});

test('processWackler: sub-threshold fuel alone keeps the standalone wording', () => {
  // TZ 0.5 is below WACKLER_TZ_ADDITIVE, so only the pure-fuel fallback can emit.
  const ws = makeRow(R, { 51: 10, 52: '100', 57: '0.5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz treibstoff');
});

test('processWackler: Mautdifferenz stays additive on a same-tier "Wackler rechnet" row', () => {
  // VKG=120 / VKG_DL=130 share the 150 kg tier (single ref) -> "Wackler rechnet";
  // an MT delta must still surface (previously it was suppressed on these rows).
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '5', 56: '3', 59: '120', 60: '130', 63: '1', 64: '2' });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 150kg ab // Mautdifferenz'
  );
});

test('processWackler: same-tier weights but multi-ref bundle -> hätte gebündelt werden müssen', () => {
  // Both weights in the 150 kg tier, ReferenzNr is a comma-joined bundle, FR delta present.
  // Bundling wins over the "Wackler rechnet" wording and is TERMINAL (v1.56.0): the MT and TZ
  // deltas an additive cascade appended are artefacts of the double billing.
  const ws = makeRow(R, {
    51: 10, 52: '100', 55: '5', 56: '3', 57: '5',
    58: '111,222', 59: '120', 60: '130', 63: '1', 64: '2',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: cross-tier weights + FR + MT + TZ -> Gewichte // Maut // Energiezuschlag', () => {
  // The fuel phrase is no longer suppressed when FR and MT are both present.
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '50', 56: '5', 57: '8', 59: '120', 60: '400', 63: '1', 64: '2' });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Differenz aufgrund abweichender Gewichte // Mautdifferenz // Differenz Energiezuschlag'
  );
});


/* ──────────────────────────────────────────────────────────
   WACKLER — AI-bundle 2026-06-05 rule updates
   Regression coverage for the rule changes derived from
   data/_bundle_extract (training.jsonl). Each test pins one
   ground-truth behaviour the engine previously got wrong.
─────────────────────────────────────────────────────────── */

test('processWackler: SNK=25 on an international row -> Terminzustellung (no Pauschalfracht reclassification)', () => {
  // Bundle rows 53130bae / e0a51926 / 7dab26f7 / b27bcf81: GB Glasgow, SNK=25, no FR/MT/TZ.
  // The old engine reclassified the SNK=25 code to "Pauschalfracht, ok?" on foreign PLZ; the
  // auditor keeps the plain domestic "Terminzustellung" code regardless of destination.
  const ws = makeRow(R, {
    51: 10, 52: '112.24', 54: '25', 59: '100', 60: '100',
    61: 'G5 0UG', 62: 'Glasgow', 63: '201FO008', 64: '612100',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Terminzustellung');
});

test('processWackler: SNK=170 alongside an AVIS code -> Avis, ok? // Terminzustellung', () => {
  // Bundle rows 27104fc7 / 7d69dfc0: AVIS=7.5, SNK=170. SNK=170 is the Terminzustellung
  // surcharge billed at the higher rate; it must resolve to a code, not the generic SNK Differenz.
  const ws = makeRow(R, {
    51: 10, 52: '175.67', 53: '7.5', 54: '170', 59: '274', 60: '274',
    61: '38090', 62: 'VILLEFONTAINE', 63: '211FO002', 64: '612110',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Avis, ok? // Terminzustellung');
});

test('processWackler: blank tariff + SNK=289 -> Umverfügung (not Lagergeld)', () => {
  // Bundle row 0f1d3d96: TARIF blank, SNK=289. A recognised bare-SNK code must beat the
  // Lagergeld catch-all for un-tariffed SNK-only rows.
  const ws = makeRow(R, {
    51: 10, 54: '289', 59: '922', 60: '922',
    61: '4061', 62: 'Pasching', 63: '211FO998', 64: '612100',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Umverfügung');
});

test('processWackler: blank tariff + SNK=43 -> 2.Zustellung ok? (not Lagergeld)', () => {
  // Bundle rows b7111e68 / fa68e7cb: TARIF blank, SNK=43.
  const ws = makeRow(R, {
    51: 10, 54: '43', 59: '308', 60: '308',
    61: '48607', 62: 'Ochtrup', 63: '211FO998', 64: '612100',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), '2.Zustellung ok?');
});

test('processWackler: blank tariff + code-less SNK still falls through to the Lagergeld query', () => {
  // Guard: the new SNK-code escape must not break the Lagergeld catch-all for un-tariffed,
  // code-less SNK gaps (SNK=60 matches no code). v1.38.0 re-phrased the storage-fee finding
  // as a query — "Lagergeld, ok?" — since it is a charge to confirm, not a proven discrepancy.
  const ws = makeRow(R, {
    51: 10, 54: '60', 59: '500', 60: '500',
    61: '12345', 62: 'Musterstadt', 63: '211FO998', 64: '612100',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Lagergeld, ok?');
});

test('processWackler: SNK=16 on a clean tariffed row -> NIGHTFIX (not the generic SNK Differenz)', () => {
  // AI-bundle 2026-09-15 row 35ad49ba (workbook 10365132, ref 2544445352): DE national, 13 Colli,
  // 2536 kg, SNK Kosten DL 17.26 vs SNK Kosten lt. Tarif 1.26 → Differenz 16.00 and no FR/MT/TZ
  // delta. The auditor's cell names the billed Wackler product ("NIGHTFIX") instead of the generic
  // SNK gap, the same way SNK≈38 reads NL-FIX — the fee amount the row shows is the only signal.
  const ws = makeRow(R, {
    51: 10, 52: '396.58', 54: '16', 58: '2544445352', 59: '2536', 60: '2536',
    61: '28307', 62: 'Bremen', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE', 68: '89160',
    69: '315.51', 70: '315.51', 71: '13', 72: '2536',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'NIGHTFIX');
});

test('processWackler: an SNK gap outside the Nightfix window keeps the generic SNK Differenz', () => {
  // Negative constraint for the new code-book entry: only |SNK| ≈ 16 is the published Nightfix
  // fee. 14 and 17.1 are unrecognised gaps on an otherwise identical row, and must keep the
  // generic wording — they must not be absorbed by the 11.5 ± 0.1 or 22 ± 0.5 neighbours either.
  const row = (snk) => makeRow(R, {
    51: 10, 52: '396.58', 54: snk, 59: '2536', 60: '2536',
    61: '28307', 62: 'Bremen', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE', 68: '89160',
    69: '315.51', 70: '315.51', 71: '13', 72: '2536',
  });
  assert.equal(e.processWackler(row('14'), R, W_COLS), 'SNK Differenz');
  assert.equal(e.processWackler(row('17.1'), R, W_COLS), 'SNK Differenz');
});

test('processWackler: same-tier multi-ref near-equal weights -> billed-tier from FR delta (MT additive)', () => {
  // Bundle row e40698ee (was f04300d4): 2 refs, VKG 6840 / VKG_DL 6862 (~0.3% apart) weigh into
  // the 7000 kg tier, but FR=-59.34 is EXACTLY rate(7500,TR)-rate(7000,TR) -> Wackler billed the
  // 7500 tier, so the note names 7500, not the raw weight tier. Near-equal weights still read as
  // one shared tier rate (not "should have been bundled"); the FR credit absorbs the fuel note,
  // and Maut stays additive. The destination zone (TR) is what lets the rate card re-tier it.
  const ws = makeRow(R, {
    51: 10, 52: '2041.03', 54: '-0.24', 55: '-59.34', 56: '-1.94', 57: '-7.71',
    58: '2543245539,2543245558', 59: '6840', 60: '6862',
    61: '41400', 62: 'GEBZE KOCAELI', 63: '211FG004', 64: '612110', 65: 'TR',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 7500kg ab // Mautdifferenz'
  );
});

test('processWackler: same-tier near-equal weights without a resolvable zone keep the weight tier', () => {
  // Guard: the billed-tier re-tiering only fires when the destination zone resolves against the
  // rate card. With no zone token the note degrades to the plain weight-tier wording (7000),
  // exactly as before the rate-card lookup was added.
  const ws = makeRow(R, {
    51: 10, 52: '2041.03', 54: '-0.24', 55: '-59.34', 56: '-1.94', 57: '-7.71',
    58: '2543245539,2543245558', 59: '6840', 60: '6862',
    61: '41400', 62: 'GEBZE KOCAELI', 63: '211FG004', 64: '612110',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 7000kg ab // Mautdifferenz'
  );
});

test('processWackler: DOMESTIC billed-tier uses the national rate card (DE2 150 -> 200 via FR)', () => {
  // Domestic German row, zone DE2: VKG 148 / VKG_DL 149 weigh into the 150 kg tier (national rate
  // 29,50 €), but the FR CREDIT -2.96 is exactly rate(200,DE2)-rate(150,DE2)=32,46-29,50 ->
  // Wackler billed the 200 kg tier. The re-tiering reads the NATIONAL card (the international
  // card leaves DE cells blank); the note stays plain — the auditor rejected the EUR suffix
  // (AI-bundle 2026-06-12).
  const ws = makeRow(R, {
    51: 10, 52: '32.46', 55: '-2.96', 57: '-0.27',
    58: '2543200001', 59: '148', 60: '149',
    61: '80331', 62: 'München', 63: '211FO002', 64: '612110', 65: 'DE2',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 200kg ab'
  );
});

test('processWackler: Empf.-Land classifies the international lane (TR export, no explicit zone token)', () => {
  // Same TR export as above, but the destination is given ONLY by Abg.-Land=DE / Empf.-Land=TR
  // (no Tarifzone column). The lane classifier reads Empf.-Land=TR -> international, resolves the
  // zone from the country code + Empf.-PLZ, and re-tiers 7000 -> 7500 off the FR delta.
  const ws = makeRow(R, {
    51: 10, 52: '2041.03', 54: '-0.24', 55: '-59.34', 56: '-1.94', 57: '-7.71',
    58: '2543245539,2543245558', 59: '6840', 60: '6862',
    61: '41400', 62: 'GEBZE KOCAELI', 63: '211FG004', 64: '612110',
    66: 'TR', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 7500kg ab // Mautdifferenz'
  );
});

test('processWackler: Abg.-Land=DE & Empf.-Land=DE classify domestic; zone comes from Empf.-PLZ', () => {
  // No explicit DEn token: the row is classified domestic purely from Abg.-Land=DE / Empf.-Land=DE,
  // and the German rate zone (DE2) is resolved from the Stuttgart PLZ 70173 — safe precisely
  // because the country is known to be DE. The FR credit -2.96 re-tiers 150 -> 200 on the
  // national card; the note stays plain (no EUR suffix).
  const ws = makeRow(R, {
    51: 10, 52: '32.46', 55: '-2.96', 57: '-0.27',
    58: '2543200001', 59: '148', 60: '149',
    61: '70173', 62: 'Stuttgart', 63: '211FO002', 64: '612110',
    66: 'DE', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 200kg ab'
  );
});

test('processWackler: foreign Empf.-Land with a German-looking PLZ gets no spurious DE EUR suffix', () => {
  // Empf.-Land=HR (Croatia): the PLZ 10450 looks like a German prefix (would have mis-resolved to
  // DE8 under the old bare-PLZ fallback), but Empf.-Land=HR classifies the row international, so it
  // never resolves a German zone and the "Wackler rechnet" note stays free of any "(DEn: … €)".
  const ws = makeRow(R, {
    51: 10, 52: '500', 55: '30', 57: '2.70',
    58: '2543299001', 59: '9760', 60: '9760',
    61: '10450', 62: 'Zagreb', 63: '211FO002', 64: '612110',
    66: 'HR', 67: 'DE',
  });
  const out = e.processWackler(ws, R, W_COLS);
  assert.ok(
    /Wackler rechnet Frachtrate für/.test(out) && !/\(DE\d/.test(out),
    `expected a plain (no German-zone EUR) Wackler rechnet note, got: ${out}`
  );
});

test('processWackler: Hebebühne credit + fuel delta -> "hätte Hebebühne abrechnen dürfen // Dieselzuschlag ok?"', () => {
  // Bundle row ce9f73d9: SNK=-150.6 (Hebebühne/liftgate credit) + TZ=-19.5, no FR. On a Hebebühne
  // row the fuel delta is the auditor's "Dieselzuschlag ok?" query, not a generic
  // "Differenz Energiezuschlag".
  const ws = makeRow(R, {
    51: 10, 52: '762.28', 54: '-150.6', 57: '-19.5',
    58: '2543248405', 59: '1869', 60: '2850',
    61: '4703 TB', 62: 'Roosendaal', 63: '211FO002', 64: '612110',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'hätte Hebebühne abrechnen dürfen // Dieselzuschlag ok?'
  );
});

test('processWackler: Hebebühne credit with no fuel delta stays a bare Hebebühne note', () => {
  // Guard: the Dieselzuschlag wording only appears when a fuel delta accompanies the Hebebühne
  // credit. Without TZ the row is just "hätte Hebebühne abrechnen dürfen".
  const ws = makeRow(R, {
    51: 10, 52: '762.28', 54: '-150.6',
    58: '2543248405', 61: '4703 TB', 62: 'Roosendaal', 63: '211FO002', 64: '612110',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte Hebebühne abrechnen dürfen');
});

test('processWackler: same-tier multi-ref with UNEQUAL weights stays "hätte gebündelt werden müssen"', () => {
  // Guard for the near-equal band: 120 vs 130 kg (~8% apart) share the 150 kg tier but are
  // materially different weights -> genuine bundling, and TERMINAL since v1.56.0.
  const ws = makeRow(R, {
    51: 10, 52: '100', 55: '5', 56: '3', 57: '5',
    58: '111,222', 59: '120', 60: '130', 63: '1', 64: '2',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: equal-weight multi-ref bundle with positive FR -> Wackler rechnet // AVIS // Maut // fuel', () => {
  // Bundle row 08a0d985: 3 refs, VKG==VKG_DL==8565 (9000 kg tier), AVIS=1, positive FR.
  // Equal weights -> "Wackler rechnet"; positive FR keeps the fuel note; AVIS=1 + MT additive.
  const ws = makeRow(R, {
    51: 10, 52: '1245.4', 53: '1', 54: '4.05', 55: '1103.6', 56: '70.11', 57: '131.77',
    58: '2543338466,2543310205,2543309624', 59: '8565', 60: '8565',
    61: '11-015', 62: 'Olsztynek', 63: '211FO011', 64: '612100',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 9000kg ab // Differenz avis, ok? // Mautdifferenz // Differenz Energiezuschlag'
  );
});

test('processWackler: foreign numeric PLZ does not get a spurious German-zone EUR suffix', () => {
  // Bundle row d97ce4ec: Swedish PLZ "556 52" must NOT resolve to a German rate zone. The
  // "Wackler rechnet" note stays plain (no "(DEn: … €)") for international destinations.
  const ws = makeRow(R, {
    51: 10, 52: '2631.25', 53: '6.5', 54: '1.65', 55: '412.34', 56: '32.27', 57: '53.6',
    58: '2543325830,2543325837', 59: '9760', 60: '9760',
    61: '556 52', 62: 'Jönköping', 63: '211FG004', 64: '612110',
  });
  const out = e.processWackler(ws, R, W_COLS);
  assert.ok(
    out.includes('Wackler rechnet Frachtrate für 10000kg ab') && !/\(DE\d/.test(out),
    `expected a plain Wackler-rechnet note with no DE-zone EUR suffix, got: ${out}`
  );
});

/* ──────────────────────────────────────────────────────────
   WACKLER — AI-bundle 2026-06-12 rule updates
   Ground truth from data/anmerkung_ai_bundle_2026-06-12-04-04-18.zip
   (source files 10352647/10352648 Soll-Ist-Vergleich). Each test
   uses the real failing row's inputs.
─────────────────────────────────────────────────────────── */

test('processWackler: a far INEXACT tier match never re-tiers the "Wackler rechnet" note', () => {
  // Bundle rows 941d66f0 / 169d8baa: VKG=VKG_DL=174 (200 kg tier), DE4, FR=+12.99. The implied
  // billed rate 42,04-12,99=29,05 sits 0,45 off rate(50,DE4)=29,50 — a far tier AND an inexact
  // match, so the multi-step re-tiering rejects it (only a NEAR-EXACT far gap re-tiers, see the
  // 3-step ec0469d0 case below). Ground truth keeps the weight tier; the old any-sign all-tier
  // search wrongly emitted a ghost "für 50kg", which the tight far-tier tolerance now blocks.
  // The EUR suffix is gone too. TZ=1.68 stays under the fuel threshold.
  const ws = makeRow(R, {
    51: 10, 52: '51.09', 54: '0.05', 55: '12.99', 56: '1.05', 57: '1.68',
    58: '2543334633', 59: '174', 60: '174',
    61: '63589', 62: 'Linsengericht', 63: '211FO011', 64: '612100',
    66: 'DE', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 200kg ab // Mautdifferenz'
  );
});

test('processWackler: FR credit with no clean adjacent tier gap keeps the weight tier', () => {
  // Bundle row 52fa91df: VKG=VKG_DL=1489 (1500 kg tier), DE9, FR=-80.79. The implied billed
  // rate 200,39+80,79=281,18 matches no published rate in the FR-credit (UP) direction within
  // tolerance, so the note keeps 1500. The FR credit absorbs the fuel note; Maut stays additive.
  const ws = makeRow(R, {
    51: 10, 52: '254.47', 54: '-0.32', 55: '-80.79', 56: '-10.58', 57: '-10.5',
    58: '2543320243', 59: '1489', 60: '1489',
    61: '21244', 62: 'Buchholz in der Nordheide', 63: '211FO011', 64: '612100',
    66: 'DE', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 1500kg ab // Mautdifferenz'
  );
});

test('processWackler: domestic "Wackler rechnet" note carries no national EUR suffix', () => {
  // Bundle row e3d56631: VKG=VKG_DL=480 (500 kg tier), DE2 resolves — the old engine decorated
  // the note with "(DE2: 58,10 €)" and the auditor struck it on every ground-truth row.
  const ws = makeRow(R, {
    51: 10, 52: '79.55', 54: '0.04', 55: '9.12', 56: '0.76', 57: '1.19',
    58: '2543330716', 59: '480', 60: '480',
    61: '72555', 62: 'Metzingen', 63: '211FO998', 64: '612100',
    66: 'DE', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 500kg ab // Mautdifferenz'
  );
});

test('processWackler: LIGHT equal-weight multi-ref bundle now reads "Wackler rechnet" (carve-out retired)', () => {
  // Was bundle row cf56daaa: 2 refs, VKG=VKG_DL=231 (250 kg tier), DE5, FR=+15.39, AVIS=8.7.
  // The light-row bundling carve-out (combined <= WACKLER_BUENDEL_MAX_KG) was retired in
  // v1.38.0 — it rested on that single row, which the 2026-08-31 evidence set does not contain,
  // while the rows that reach the branch there (9b8769a3, 3f501ba0) expect the rate-card note.
  // Identical weights on one shared tier are one tier rate at any weight. MT/TZ stay additive,
  // AVIS resolves to "Avis, ok?".
  const ws = makeRow(R, {
    51: 10, 52: '78.9', 53: '8.7', 54: '0.07', 55: '15.39', 56: '1.25', 57: '2.01',
    58: '2543320386,2543320633', 59: '231', 60: '231',
    61: '95100', 62: 'Selb', 63: '211FO998', 64: '612100',
    66: 'DE', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Avis, ok? // Wackler rechnet Frachtrate für 250kg ab // Mautdifferenz // Differenz Energiezuschlag'
  );
});

test('processWackler: HEAVY equal-weight multi-ref bundle stays "Wackler rechnet" (domestic)', () => {
  // Bundle row 9ab8df23: 4 refs, VKG=VKG_DL=2556 (2600 kg tier), DE6, FR=+187.06. Above the
  // bundling weight ceiling the row reads as tier billing, with MT and fuel itemised and no
  // EUR suffix. AVIS=17.4 matches no code and stays silent.
  const ws = makeRow(R, {
    51: 10, 52: '373.01', 53: '17.4', 54: '0.75', 55: '187.06', 56: '25.42', 57: '24.32',
    58: '2543241414,2543254161,2543241418,2543241424', 59: '2556', 60: '2556',
    61: '99820', 62: 'Hörselberg-Hainich', 63: '211FO011', 64: '612100',
    66: 'DE', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 2600kg ab // Mautdifferenz // Differenz Energiezuschlag'
  );
});

test('processWackler: cross-tier multi-ref with near weights + positive FR -> bundling', () => {
  // Bundle row 447856d4: 2 refs, VKG=5465,44 (5500 tier) vs VKG_DL=6158 (6500 tier) — 12.7%
  // apart, FR=+65.6: the system rated the references separately while Wackler billed them as
  // one, so the booking should have been bundled. TERMINAL: the AVIS 8.7, MT and TZ deltas are
  // artefacts of the double billing (v1.56.0).
  const ws = makeRow(R, {
    51: 10, 52: '554.22', 53: '8.7', 54: '0.27', 55: '65.6', 56: '4.16', 57: '8.53',
    58: '2543276386,2543320440', 59: '5465,44', 60: '6158',
    61: '76829', 62: 'Landau in der Pfalz', 63: '211FO011', 64: '612100',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: cross-tier multi-ref with FAR-apart weights stays abweichende Gewichte', () => {
  // Guard from AI-bundle 2026-06-05 row 3ac4d429: 2 refs, VKG=8019 vs VKG_DL=11141 (39% apart),
  // FR=+1110.86 — a genuine weight discrepancy, NOT a bundling finding, despite the positive FR.
  const ws = makeRow(R, {
    51: 10, 52: '1361.54', 53: '1', 54: '4.02', 55: '1110.86', 56: '69.38', 57: '130.37',
    58: '2543310716,2543310266', 59: '8019', 60: '11141',
    61: '11-015', 62: 'Olsztynek', 63: '211FO011', 64: '612100',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Differenz aufgrund abweichender Gewichte // Differenz avis, ok? // Mautdifferenz // Differenz Energiezuschlag'
  );
});

test('processWackler: cross-tier multi-ref with near weights but an FR CREDIT stays abweichende Gewichte', () => {
  // Guard from AI-bundle 2026-06-05 row 3aaa6bed: 3 refs, VKG=2850 (3000 tier) vs VKG_DL=2705
  // (2800 tier) — only 5% apart, but FR=-117.08 is a credit: Wackler billed MORE, which is a
  // weight discrepancy, never a should-have-bundled finding. The credit absorbs the fuel note.
  const ws = makeRow(R, {
    51: 10, 52: '1416.65', 54: '-0.46', 55: '-117.08', 56: '-6.61', 57: '-15.22',
    58: '503463856,503463857,503467086', 59: '2850', 60: '2705',
    61: 'UB8 2YF', 62: 'Uxbridge Middlesex', 63: '201FO001', 64: '612110',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Differenz aufgrund abweichender Gewichte // Mautdifferenz'
  );
});


/* ──────────────────────────────────────────────────────────
   WACKLER — AI-bundle 2026-06-16 rule updates
   Three failure rows: an 80 € SNK Terminzustellung surcharge on
   weighed shipments, and a positive-FR down-tiering of the
   "Wackler rechnet" note.
─────────────────────────────────────────────────────────── */

test('processWackler: SNK=80 on a weighed shipment -> Terminzustellung (not Pauschalfracht)', () => {
  // Bundle row a54fc7ee: VKG=VKG_DL=75, SNK=80, tarif 54.91 (|SNK| >= tariff), IT, no FR/MT/TZ.
  // |SNK| >= tariff would have read as "Pauschalfracht, ok?", but a real chargeable weight makes
  // the 80 € SNK a Terminzustellung surcharge — the weight gate splits the two readings.
  const ws = makeRow(R, {
    51: 10, 52: '54.91', 54: '80', 59: '75', 60: '75',
    61: '52045', 62: 'FOIANO DELLA CHIANA', 63: '211FO002', 64: '612110', 66: 'IT', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Terminzustellung');
});

test('processWackler: SNK=80 on a weighed shipment -> Terminzustellung (not SNK Differenz)', () => {
  // Bundle row 278691a9: VKG=VKG_DL=152, SNK=80, tarif 81.7 (|SNK| < tariff so never Pauschalfracht),
  // IT, no FR/MT/TZ. The bare 80 € SNK previously fell through to the generic "SNK Differenz"
  // fallback; it now resolves to the Terminzustellung code via the weight gate.
  const ws = makeRow(R, {
    51: 10, 52: '81.7', 54: '80', 59: '152', 60: '152',
    61: '50031', 62: 'BARBERINO DI MUGELLO', 63: '211FO002', 64: '612110', 66: 'IT', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Terminzustellung');
});

test('processWackler: no-weight SNK=80 with |SNK| >= tariff stays Pauschalfracht (weight gate)', () => {
  // Guard for the split above: with NO chargeable weight the 80 € SNK is a flat-rate lump charge,
  // so |SNK| >= tariff still reads as "Pauschalfracht, ok?" — the Terminzustellung code must not
  // poach it. (Same as the original 54.95/80 Pauschalfracht row, made explicit against the gate.)
  const ws = makeRow(R, { 51: 10, 52: '54.91', 54: '80', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Pauschalfracht, ok?');
});

test('processWackler: positive FR down-tiers the "Wackler rechnet" note to the floor tier', () => {
  // Bundle row f6cb2770: 2 refs, VKG=VKG_DL=2125 weigh into the 2200 kg tier (NL), but FR=+17.83 is
  // EXACTLY rate(2200,NL)-rate(2000,NL)=407,56-389,73 -> Wackler billed the 2000 tier (one step
  // DOWN). The note must name 2000, not the raw 2200 weight tier. MT and (positive-FR) fuel stay
  // additive. The destination zone (NL) is what lets the rate card re-tier it.
  const ws = makeRow(R, {
    51: 10, 52: '472.57', 54: '0.05', 55: '17.83', 56: '1.42', 57: '2.32',
    58: '2543438622,2543438654', 59: '2125', 60: '2125',
    61: '8242 PN', 62: 'Lelystad', 63: '211FO002', 64: '612110', 66: 'NL', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 2000kg ab // Mautdifferenz // Differenz Energiezuschlag'
  );
});

test('processWackler: positive FR down-tiers MULTIPLE steps on a near-exact gap (GB, no Land column)', () => {
  // Bundle row ec0469d0: single ref, VKG 2496 / VKG_DL 2494 weigh into the 2600 kg tier, but
  // FR=+310.3 is EXACTLY rate(2600,GB2)-rate(2000,GB2)=1001,40-691,10 -> Wackler billed the 2000
  // tier, THREE steps down. Two things make this row work: (1) the destination is a UK postcode
  // "RG30 1BD" with NO Empf.-Land / Tarifzone column, so the GB zone is resolved straight from the
  // letter-led postcode (it can't be a numeric German PLZ); (2) the re-tiering walks past the
  // adjacent 2400/2200 brackets to the near-exact 2000 match. Single ref -> wacklerRechnetFired,
  // so the TZ=40.34 fuel gap is absorbed (no Energiezuschlag note); MT=36.32 stays additive.
  const ws = makeRow(R, {
    51: 10, 52: '833.73', 54: '0.93', 55: '310.3', 56: '36.32', 57: '40.34',
    58: '503472974', 59: '2496', 60: '2494',
    61: 'RG30 1BD', 62: 'Reading', 63: '201FO001', 64: '612110',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 2000kg ab // Mautdifferenz'
  );
});

test('processWackler: a numeric foreign-looking PLZ with no Land column never resolves a GB zone', () => {
  // Guard for the GB-postcode fallback: it must fire ONLY for letter-led UK postcodes. A bare
  // numeric PLZ (here an Italian "29012", no Land/zone column) stays unresolved, so the billed-tier
  // re-tiering can't run and the note keeps the raw weight tier — exactly as before the fallback.
  // (The real engine re-tiers this row via its Empf.-Land column, which this isolation test omits.)
  const ws = makeRow(R, {
    51: 10, 52: '747.28', 55: '-8.48', 56: '-0.76', 57: '-1.11',
    58: '2543480405', 59: '2280', 60: '2284',
    61: '29012', 62: 'Caorso', 63: '211FO002', 64: '612110',
  });
  const out = e.processWackler(ws, R, W_COLS);
  assert.ok(
    out.includes('Wackler rechnet Frachtrate für 2400kg ab'),
    `expected the plain weight-tier note (2400, no GB re-tier), got: ${out}`
  );
});

test('processWackler: FR Kosten lt. Tarif names the tier DIRECTLY off the rate card', () => {
  // Real values from workbook 10354157 row 20 (ec0469d0), GB2, VKG 2496 -> 2600 weight tier. The
  // sheet carries the FR freight columns: FR Kosten lt. Tarif = 691,10 = rate(2000,GB2) (the tariff
  // freight) and FR Kosten DL = 1001,40 = rate(2600,GB2) (what Wackler billed), FR Differenz =
  // +310,30 = DL − Tarif (an overcharge). The note reports the TARIFF tier, read straight off the
  // rate card from Kosten lt. Tarif -> 2000 (NOT 2600, the billed tier). MT=36.32 stays additive.
  const ws = makeRow(R, {
    51: 10, 52: '833.73', 54: '0.93', 55: '310.3', 56: '36.32', 57: '40.34',
    58: '503472974', 59: '2496', 60: '2494',
    61: 'RG30 1BD', 62: 'Reading', 63: '201FO001', 64: '612110',
    69: '691.10', 70: '1001.40', // FR Kosten lt. Tarif / FR Kosten DL
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 2000kg ab // Mautdifferenz'
  );
});

test('processWackler: FR Kosten DL − FR Differenz resolves the tariff tier when no Tarif column', () => {
  // Only FR Kosten DL is present (no Kosten lt. Tarif column). The tariff freight is derived as
  // Kosten DL − FR Differenz = 1001,40 − 310,30 = 691,10 = rate(2000,GB2) -> the same 2000 tier,
  // proving the fallback derivation off the billed cost.
  const ws = makeRow(R, {
    51: 10, 52: '833.73', 54: '0.93', 55: '310.3', 56: '36.32', 57: '40.34',
    58: '503472974', 59: '2496', 60: '2494',
    61: 'RG30 1BD', 62: 'Reading', 63: '201FO001', 64: '612110',
    70: '1001.40', // FR Kosten DL only
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 2000kg ab // Mautdifferenz'
  );
});

test('processWackler: an off-card FR Kosten lt. Tarif falls back to the FR-delta inference', () => {
  // Guard: FR Kosten lt. Tarif = 700,00 matches no published GB2 tier rate within tolerance, so the
  // direct lookup yields nothing and the engine falls back to the rate(weightTier) − FR-delta walk —
  // which still re-tiers 2600 -> 2000 via FR=+310.3. An off-card tariff value must never break a row
  // the FR delta alone already solves.
  const ws = makeRow(R, {
    51: 10, 52: '833.73', 54: '0.93', 55: '310.3', 56: '36.32', 57: '40.34',
    58: '503472974', 59: '2496', 60: '2494',
    61: 'RG30 1BD', 62: 'Reading', 63: '201FO001', 64: '612110',
    69: '700.00', // off-card FR Kosten lt. Tarif
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 2000kg ab // Mautdifferenz'
  );
});


/* ──────────────────────────────────────────────────────────
   WACKLER — AI-bundle 2026-07-16 rule updates
   Two patterns: SNK Nachlauf codes 49/113 (NL-12 / NL-SPEZ
   queries instead of the generic SNK Differenz), and the
   partial-billing bundle (VKG_DL a small fraction of VKG on a
   cross-tier multi-ref row -> terminal bundling finding).
─────────────────────────────────────────────────────────── */

test('processWackler: SNK=49 -> "NL-12, ok?" (not SNK Differenz)', () => {
  // Bundle row b9ca0d3c: SNK=49, equal weights, no FR/MT/TZ, DE Waghäusel.
  const ws = makeRow(R, {
    51: 10, 52: '586.97', 54: '49', 58: '2543825001', 59: '4983', 60: '4983',
    61: '68753', 62: 'Waghäusel', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'NL-12, ok?');
});

test('processWackler: SNK=113 + AVIS code -> "Avis, ok? // NL-SPEZ, ok?"', () => {
  // Bundle row f914abff: AVIS=8.7 stays additive next to the NL-SPEZ Nachlauf query.
  const ws = makeRow(R, {
    51: 10, 52: '321.91', 53: '8.7', 54: '113', 58: '2543869370', 59: '2750', 60: '2750',
    61: '68753', 62: 'Waghäusel', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Avis, ok? // NL-SPEZ, ok?');
});

test('processWackler: SNK=250 -> "Zusatzkosten 250 €, ok?" (not SNK Differenz)', () => {
  // Bundle row a75a84e6 (10367543 r=30; e87fecfb r=222 is the same 250.00 gap at tarif 562.74).
  // v1.56.0: the label is the unquoted October spelling. The September cells still carry the
  // quotes and are a pending workbook correction; the quoted spelling folds onto the same catalog
  // key via PHRASE_LITERALS, so both resolve to zusatzkosten250.
  const ws = makeRow(R, {
    51: 10, 52: '618.73', 54: '250', 58: '2544673051,2544576995', 59: '3625', 60: '5369',
    61: '63505', 62: 'Langenselbold', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Zusatzkosten 250 €, ok?');
});

test('processWackler: SNK=81 -> "NL-10, ok?" (not Pauschalfracht, ok?)', () => {
  // Bundle row a7a1c653 (10367543 r=80): SNK DL 81.14 vs lt. Tarif 0.14 -> 81.00, tarif 52.19,
  // weights present, no FR/MT/TZ. Without the 81 code-book entry rule 2 read 81 ≥ 1.0 × 52.19
  // as a flat-rate "Pauschalfracht, ok?".
  const ws = makeRow(R, {
    51: 10, 52: '52.19', 54: '81', 58: '2544760100', 59: '157', 60: '157',
    61: '76135', 62: 'Karlsruhe', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'NL-10, ok?');
});

test('processWackler: SNK=80.5 on a weighed shipment -> Terminzustellung', () => {
  // Boundary guard between the two windows: the weight-gated Terminzustellung 80 window
  // (80 ± 0.5) and the NL-10 code-book window (81 ± 0.49) touch at 80.50, and the 80 boundary
  // is inclusive. The code book is queried first, so a tol of 0.5 there would read 80.50 as
  // NL-10 and the termin80 fallback below it in rule 4 would never fire.
  const ws = makeRow(R, {
    51: 10, 52: '81.7', 54: '80.5', 59: '152', 60: '152',
    61: '50031', 62: 'BARBERINO DI MUGELLO', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Terminzustellung');
});

test('processWackler: partial-billing bundle (FR credit) -> terminal "hätte gebündelt werden müssen"', () => {
  // Bundle row 81dd411f: 2 refs, VKG=3540 / VKG_DL=94 (2.7%), FR=-15.39, AVIS=8.7, MT=-3.67.
  // The DL billed one consignment of the bundle; AVIS and Maut are artefacts and stay suppressed.
  const ws = makeRow(R, {
    51: 10, 52: '282.89', 53: '8.7', 54: '-0.06', 55: '-15.39', 56: '-3.67', 57: '-1.77',
    58: '2543877957,2543833208', 59: '3540', 60: '94',
    61: '89081', 62: 'Ulm', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: partial-billing bundle (positive FR) suppresses SNK/Maut/fuel too', () => {
  // Bundle row 45c3d6e8: 3 refs, VKG=2079 / VKG_DL=152 (7.3%), FR=+30.21, SNK=226.12,
  // MT=4.05, TZ=3.47 — the truth cell carries ONLY the bundling phrase.
  const ws = makeRow(R, {
    51: 10, 52: '301.52', 53: '26.1', 54: '226.12', 55: '30.21', 56: '4.05', 57: '3.47',
    58: '2543938364,2543938391,2543938397', 59: '2079', 60: '152',
    61: '68753', 62: 'Waghäusel', 63: '211FO011', 64: '612100', 66: 'DE', 67: 'DE',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: 2-ref half-split (VKG_DL 49% of VKG) stays abweichende Gewichte', () => {
  // Guard from workbook 10354157 row 13: GB, 2 refs, VKG=2280 / VKG_DL=1120 (49%), FR=-455.42.
  // A genuine half-split across two consignments is a weight discrepancy, not partial billing —
  // this row forced WACKLER_BUENDEL_PARTIAL down to 0.2. The FR credit absorbs the fuel note.
  const ws = makeRow(R, {
    51: 10, 52: '1070.53', 54: '-1.37', 55: '-455.42', 56: '-62.54', 57: '-59.21',
    58: '503474541,503474542', 59: '2280', 60: '1120',
    61: 'MK5 8GH', 62: 'Knowlhill', 63: '201FO001', 64: '612110', 66: 'GB', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Differenz aufgrund abweichender Gewichte // Mautdifferenz'
  );
});

test('processWackler: 2026-08-31 bundle — pallet volume boundary gate (4c4576a6)', () => {
  // Row 4c4576a6 (10361841 r=3): 30 colli, vkg=8474, vkg_dl=8481, palletVol=8550 (0.9% gap -> tier 9000).
  // Pallet volume within 5% of vkg does not trigger abweichende Gewichte; emits "Wackler rechnet".
  const ws = makeRow(R, {
    51: 10, 52: '2103.87', 54: '0.22', 55: '56.08', 57: '5.05',
    58: '2544271231,2544299476', 59: '8474', 60: '8481',
    61: '45340', 62: 'ONTIGOLA', 63: '211FG004', 64: '612110', 66: 'ES', 67: 'DE',
    68: '89160', 69: '1832.12', 70: '1888.20', 71: 30, 72: 4429
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 9000kg ab // Differenz Energiezuschlag'
  );
});

/* ── 10369563 / 10369566 / 10369604: the corrected 2026-10-21 bundle ─────────
   Inputs come from the tool's own Before/ workbooks, the expected strings from the
   truth workbooks. None of the 13 rows carries a rate-card tier, so these replays do
   not need the local rate card. Mismatches: none. */
function replayWackler(name) {
  const fx = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  assert.deepEqual(fx.outliers, []);
  const mismatches = [];
  for (const x of fx.rows) {
    const cells = {};
    for (const [k, v] of Object.entries(x)) {
      if (k === 'row' || k === 'truth') continue;
      assert.ok(W_COLS[k] !== undefined, `${name} row ${x.row}: unknown column ${k}`);
      cells[W_COLS[k]] = v;
    }
    const out = e.processWackler(makeRow(R, cells), R, W_COLS);
    if (out !== x.truth) mismatches.push(`${x.row}: ${out} != ${x.truth}`);
  }
  return { fx, mismatches };
}

test('processWackler: 10369563 replay agrees on 2/2, no mismatches', () => {
  // Row 8 is the standalone fuel row, row 32 the flat-freight row.
  const { fx, mismatches } = replayWackler('wackler-10369563-rows.json');
  assert.equal(fx.rows.length, 2);
  assert.deepEqual(mismatches, []);
});

test('processWackler: 10369566 replay agrees on 9/9, no mismatches', () => {
  // Every row 4-12 was delivered to the Riedlingen return hub.
  const { fx, mismatches } = replayWackler('wackler-10369566-rows.json');
  assert.equal(fx.rows.length, 9);
  assert.deepEqual(mismatches, []);
});

test('processWackler: 10369604 replay agrees on 2/2, no mismatches', () => {
  const { fx, mismatches } = replayWackler('wackler-10369604-rows.json');
  assert.equal(fx.rows.length, 2);
  assert.deepEqual(mismatches, []);
});

test('processWackler: 10369999 / 10370014 / 10370017 replays agree, no mismatches', () => {
  // The 2026-10-23 bundle rows the engine now gets right: the 10369999 FR-credit weight rows plus
  // the fixed residual-SNK row 32, the 10370014 fuel/250/bundle rows, and 10370017 rows 18 and 122
  // (the Einlagerung pair and the row that starts AND ends at the Riedlingen hub). The known-miss
  // rows (10369999 r27, 10370014 r4, 10370017 r126) are pinned by their own assertions above, not
  // by a fixture.
  for (const [name, n] of [['wackler-10369999-rows.json', 4], ['wackler-10370014-rows.json', 7],
    ['wackler-10370017-rows.json', 2]]) {
    const { fx, mismatches } = replayWackler(name);
    assert.equal(fx.rows.length, n, name);
    assert.deepEqual(mismatches, [], name);
  }
});

/* ──────────────────────────────────────────────────────────
   WACKLER — audit 2026-10-23 bundle (v1.56.0)
   D1 terminal bundling, D2 rate-based fuel suppression, D3
   the 250 € surcharge on the freight axis, D4 the residual SNK
   absorbed by a weight finding, D5 the Return origin gate.
─────────────────────────────────────────────────────────── */

test('processWackler: a bundle row is TERMINAL — 10370014 row 218 keeps the phrase alone', () => {
  // D1. r218: 2 refs, colli 28, VKG 4389,538 vs VKG_DL 4526 (3.0% apart), AVIS 8.7, MT 2.50,
  // TZ 4.58, FR +33.96, equal fuel rates. Truth is the bundling phrase alone.
  const ws = makeRow(R, {
    51: 10, 52: '725.60', 53: '8.7', 54: '0.16', 55: '33.96', 56: '2.50', 57: '4.58',
    58: '2544971201,2544969647', 59: '4389,538', 60: '4526', 61: '37124', 62: 'Rosdorf',
    63: '211FO011', 64: '612100', 69: '565.08', 70: '599.04', 71: '28', 72: '4521,538',
    73: '80.87', 74: '76.29',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: the legacy no-weights bundling arm is terminal too', () => {
  // D1, the multi-ref + FR + no-weights arm: SNK and MT deltas are discarded with the bundling.
  const ws = makeRow(R, {
    51: 10, 52: '100', 54: '6', 55: '5', 56: '3', 58: 'a,b', 63: '1', 64: '2',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'hätte gebündelt werden müssen');
});

test('processWackler: differing fuel rates keep the fuel finding (10362275 row 18)', () => {
  // D2. Fuel 0.090 on the DL side (46.39/515.41) vs 0.1174 on the tariff side (57.89/493.22):
  // a real rate difference, so the fuel gap stays itemised — as the Hebebühne query, next to the
  // weight finding.
  const ws = makeRow(R, {
    51: 10, 52: '749.43', 54: '-150.51', 55: '22.19', 57: '-11.5', 58: '2544312035',
    59: '1863', 60: '3135', 61: '4703 TB', 62: 'Roosendaal', 63: '211FO002', 64: '612110',
    69: '493.22', 70: '515.41', 71: '11', 72: '1863', 73: '46.39', 74: '57.89',
  });
  assert.equal(e.processWackler(ws, R, W_COLS),
    'Differenz aufgrund abweichender Gewichte // hätte Hebebühne abrechnen dürfen // Dieselzuschlag ok?');
});

test('processWackler: equal fuel rates suppress the fuel finding; a rate difference restores it', () => {
  // D2. 10369999 row 32: fuel 0.135 on both sides (428.33/3172.79 vs 256.09/1896.99), so the
  // TZ delta is freight x rate and the weight finding stands alone next to the toll note.
  const base = {
    51: 10, 52: '2337.56', 54: '6.38', 55: '1275.80', 56: '74.50', 57: '172.24',
    58: '1060379428,1060378346', 59: '1316', 60: '5985', 63: 'X', 64: 'X',
    69: '1896.99', 70: '3172.79', 71: '21', 72: '1316',
  };
  assert.equal(e.processWackler(makeRow(R, { ...base, 73: '428.33', 74: '256.09' }), R, W_COLS),
    'Differenz aufgrund abweichender Gewichte // Mautdifferenz');
  // A tariff-side fuel rate of 0.21 on the same row is a real difference and is itemised again.
  assert.equal(e.processWackler(makeRow(R, { ...base, 73: '428.33', 74: '398.37' }), R, W_COLS),
    'Differenz aufgrund abweichender Gewichte // Mautdifferenz // Differenz Energiezuschlag');
});

test('processWackler: differing fuel rates keep the standalone fuel wording (10370014 row 259)', () => {
  // D2. FR is 0 (both cells 230.60), so there is no freight delta for the fuel to ride on; the
  // rates differ (0.27 vs 0.135) and the standalone wording stands. Values are the workbook row:
  // Volumen kg 4280 / Volumen kg DL 4280, Anz. Colli 33, Brutto 4280.
  const ws = makeRow(R, {
    51: 10, 52: '298.84', 53: '0', 54: '1.15', 55: '0', 56: '0', 57: '31.13', 58: '2545021857',
    59: '4280', 60: '4280', 61: '89081', 62: 'Ulm', 63: '211FO011', 64: '612100',
    69: '230.60', 70: '230.60', 71: '33', 72: '4280', 73: '62.26', 74: '31.13',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz treibstoff');
});

test('processWackler: a 45-column layout without TZ Kosten cells keeps the plain fuel threshold', () => {
  // D2 guard: with no tz_dl / tz_tar columns (-1) the rates are unknown, so the |TZ| ≥ 2
  // threshold decides exactly as before. Same for a row whose fuel line is blank.
  const cols = { ...W_COLS, tz_dl: -1, tz_tar: -1 };
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '50', 56: '5', 57: '8', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, cols),
    'Frachtdifferenz // Mautdifferenz // Differenz Energiezuschlag');
});

test('processWackler: an FR credit suppresses fuel even when the rates differ (10362275 row 19)', () => {
  // D2 keeps the frIsCredit gate: the fuel rides on the over-billed freight, so it is absorbed.
  const ws = makeRow(R, {
    51: 10, 52: '791.53', 54: '-150.68', 55: '-20.81', 56: '-1.7', 57: '-15.38',
    58: '2544312518,2544312513', 59: '1901', 60: '2958', 61: '64-100', 62: 'Strzyzewice, Leszno',
    63: '211FO002', 64: '612110', 69: '533.64', 70: '512.83', 71: '11', 72: '1901',
    73: '46.15', 74: '61.53',
  });
  assert.equal(e.processWackler(ws, R, W_COLS),
    'Differenz aufgrund abweichender Gewichte // Mautdifferenz // hätte Hebebühne abrechnen dürfen');
});

test('processWackler: an FR delta of exactly 250 fires the Zusatzkosten, one finding both axes', () => {
  // D3. 10370014 rows 22 / 250 / 253: FR 250.00 with MT/SNK/TZ/AVIS all exactly 0.
  const ws = makeRow(R, {
    51: 10, 52: '350.90', 53: '0', 54: '0', 55: '250', 56: '0', 57: '0', 58: '2544768730',
    59: '600', 60: '600', 63: '211FO011', 64: '612100', 69: '271.40', 70: '521.40',
    73: '36.64', 74: '36.64',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Zusatzkosten 250 €, ok?');
  // Sign-agnostic, like the flat-freight arm it narrows.
  assert.equal(e.processWackler(makeRow(R, {
    51: 10, 52: '350.90', 55: '-250', 58: '2544768730', 59: '600', 60: '600', 63: '1', 64: '2',
  }), R, W_COLS), 'Zusatzkosten 250 €, ok?');
});

test('processWackler: the FR 250 arm needs a clean 250 and every other delta at zero', () => {
  // D3 guards, one per column: MT, SNK, TZ and AVIS each keep the row on the weight cascade, and
  // 249.4 is not the surcharge.
  const base = {
    51: 10, 52: '350.90', 55: '250', 58: '2544768730', 59: '600', 60: '600', 63: '1', 64: '2',
  };
  assert.equal(e.processWackler(makeRow(R, { ...base, 56: '5' }), R, W_COLS),
    'Wackler rechnet Frachtrate für 600kg ab // Mautdifferenz');
  assert.equal(e.processWackler(makeRow(R, { ...base, 54: '6' }), R, W_COLS),
    // SNK 6 clears the 5.0 noise floor, so rule 9 still names it: this is a rate-card row, not a
    // weight finding, and D4 only absorbs the gap into the latter.
    'Wackler rechnet Frachtrate für 600kg ab // SNK Differenz');
  assert.equal(e.processWackler(makeRow(R, { ...base, 57: '2.1' }), R, W_COLS),
    'Wackler rechnet Frachtrate für 600kg ab');
  assert.equal(e.processWackler(makeRow(R, { ...base, 53: '7.5' }), R, W_COLS),
    'Avis, ok? // Wackler rechnet Frachtrate für 600kg ab');
  assert.equal(e.processWackler(makeRow(R, { ...base, 55: '249.4' }), R, W_COLS),
    'Pauschalfracht, ok?');
});

test('processWackler: SNK 6.38 beside a weight finding loses "SNK Differenz" (10369999 row 32)', () => {
  // D4: the residual SNK gap is part of the weight finding, not a second one.
  const ws = makeRow(R, {
    51: 10, 52: '2337.56', 54: '6.38', 55: '1275.80', 56: '74.50', 57: '172.24',
    58: '1060379428,1060378346', 59: '1316', 60: '5985', 63: 'X', 64: 'X',
    69: '1896.99', 70: '3172.79', 71: '21', 72: '1316', 73: '428.33', 74: '256.09',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz aufgrund abweichender Gewichte // Mautdifferenz');
});

test('processWackler: a quiet 70 EUR SNK gap reads as the Einlagerung pair (10370017 row 18)', () => {
  // D6: SNK 70, every other delta 0. The row carries only the 70 sum; the owner reads it as the
  // 40 + 30 storage fee, in that order.
  const ws = makeRow(R, {
    51: 10, 52: '120.27', 53: '0', 54: '70', 55: '0', 56: '0', 57: '0', 58: '2544983744,2544976646',
    59: '589', 60: '589', 61: '79539', 62: 'Lörrach', 63: '211FO998', 64: '612100',
  });
  assert.equal(e.processWackler(ws, R, W_COLS),
    'Einlagerung 40 €, ok? // Einlagerung 30 €, ok?');
});

test('processWackler: the Einlagerung pair needs a quiet row (D6 guard)', () => {
  // Any FR/MT/TZ/AVIS delta or a gap outside 70 ± 0.5 keeps the generic phrase.
  const base = {
    51: 10, 52: '120.27', 53: '0', 54: '70', 55: '0', 56: '0', 57: '0', 58: '2544983744',
    59: '589', 60: '589', 61: '79539', 62: 'Lörrach', 63: '211FO998', 64: '612100',
  };
  for (const override of [{ 56: '2.5' }, { 57: '2.5' }, { 53: '8.7' }, { 54: '70.6' }, { 54: '30.78' }]) {
    const out = e.processWackler(makeRow(R, { ...base, ...override }), R, W_COLS);
    assert.ok(out.includes('SNK Differenz'), `${JSON.stringify(override)}: ${out}`);
    assert.ok(!out.includes('Einlagerung'), `${JSON.stringify(override)}: ${out}`);
  }
});

test('processWackler: the Einlagerung window is 70 +- 0.5, sign-insensitive and FR-gated (D6 bounds)', () => {
  // Tester addition: the tolerance edge is inclusive and the sign is ignored (like the code book),
  // and a row with an FR delta is a freight finding first, so the pair must not appear there.
  const base = {
    51: 10, 52: '120.27', 53: '0', 54: '70', 55: '0', 56: '0', 57: '0', 58: '2544983744',
    59: '589', 60: '589', 61: '79539', 62: 'Lörrach', 63: '211FO998', 64: '612100',
  };
  const pair = 'Einlagerung 40 €, ok? // Einlagerung 30 €, ok?';
  const out = (override) => e.processWackler(makeRow(R, { ...base, ...override }), R, W_COLS);
  assert.equal(out({ 54: '69.5' }), pair, 'lower edge is inclusive');
  assert.equal(out({ 54: '70.5' }), pair, 'upper edge is inclusive');
  assert.equal(out({ 54: '-70' }), pair, 'a credit is sign-insensitive');
  assert.equal(out({ 54: '69.49' }), 'SNK Differenz', 'just outside the lower edge');
  assert.equal(out({ 54: '70.51' }), 'SNK Differenz', 'just outside the upper edge');
  for (const override of [{ 55: '2.5' }, { 57: '2.0' }]) {
    const got = out(override);
    assert.ok(got.includes('SNK Differenz'), `${JSON.stringify(override)}: ${got}`);
    assert.ok(!got.includes('Einlagerung'), `${JSON.stringify(override)}: ${got}`);
  }
});

test('processWackler: a rate-card row keeps its own SNK gap (single ref, SNK 70)', () => {
  // D4 boundary: the rate-card arms also set gewichteTriggered, but "Wackler rechnet" says
  // nothing about the SNK line, so the SNK gap must stay visible (reviewer repro: VKG = VKG_DL
  // = 3135, FR +22.19, TZ 0, SNK 70).
  const ws = makeRow(R, {
    51: 10, 52: '1000', 54: '70', 55: '22.19', 56: '0', 57: '0', 58: '2544000001',
    59: '3135', 60: '3135', 63: '211FO011', 64: '612100', 69: '1000', 70: '1022.19',
    71: '1', 72: '3135', 73: '0', 74: '0',
  });
  assert.equal(e.processWackler(ws, R, W_COLS),
    'Wackler rechnet Frachtrate für 3500kg ab // SNK Differenz');
});

test('processWackler: the Return rule needs a non-hub origin (10370017 row 122)', () => {
  // D5: 88499 at both ends is outbound traffic — the row falls through to its AVIS code.
  const cells = {
    51: 10, 52: '153', 53: '8.7', 54: '0', 55: '0', 56: '0', 57: '0', 58: '2545010234,2545034270',
    59: '1410', 60: '1410', 61: '88499', 62: 'RIEDLINGEN', 67: 'DE', 66: 'DE',
    68: '88499', 69: '119.60', 70: '119.60', 71: '8', 72: '1410',
  };
  assert.equal(e.processWackler(makeRow(R, cells), R, W_COLS), 'Avis, ok?');
  assert.equal(e.processWackler(makeRow(R, { ...cells, 68: '89160' }), R, W_COLS), 'Return, ok?');
  const noOrigin = { ...cells };
  delete noOrigin[68];
  assert.equal(e.processWackler(makeRow(R, noOrigin), R, W_COLS), 'Return, ok?',
    'a blank origin cell keeps the return reading');
});

test('processWackler: the two changed misses stay pinned', () => {
  // D1 / D2 changed these two rows without fixing them: 10369999 row 27 loses the SNK residual but
  // keeps the weight finding (truth is the bundling phrase, D5 of the ruling not adopted), and
  // 10370014 row 4 keeps the rate-card note with its Maut delta (truth is a bundle; the only
  // separator is the corpus's single AVIS 17.40).
  assert.equal(e.processWackler(makeRow(R, {
    51: 10, 52: '2441.83', 54: '-6.79', 55: '-1357.61', 56: '-155.78', 57: '-183.27',
    58: '1060376663,1060376569', 59: '1296,434', 60: '1679', 63: 'X', 64: 'X',
    69: '1965.13', 70: '607.52', 71: '24', 72: '1296,434', 73: '82.02', 74: '265.29',
  }), R, W_COLS), 'Differenz aufgrund abweichender Gewichte // Mautdifferenz');
  assert.equal(e.processWackler(makeRow(R, {
    51: 10, 52: '124.75', 53: '17.4', 54: '0.49', 55: '98.37', 56: '7.98', 57: '13.28',
    58: '2545021794,2545021783', 59: '664', 60: '664', 63: '211FO011', 64: '612100',
    69: '102.16', 70: '200.53', 71: '4', 72: '664', 73: '27.07', 74: '13.79',
  }), R, W_COLS), 'Wackler rechnet Frachtrate für 700kg ab // Mautdifferenz');
});

/* ──────────────────────────────────────────────────────────
   HONOLD — the note is decided from FR Kosten DL against the
   encrypted OLD-tariff matrix, with the DL weight and the row's
   own FR Kosten lt. Tarif as the two confirmations 1.58.0 added.
─────────────────────────────────────────────────────────── */
const HONOLD_COLS = { stat: 50, fr_dl: 51, vkg: 52, empf_land: 53 };
const HONOLD_COLS_ZZ = { ...HONOLD_COLS, zz: 55 };
/* The 1.58.0 maps: Volumen kg DL at 54, FR Kosten lt. Tarif at 56. The two maps above
   stay as they are on purpose - they are the absent-column suite, the pre-1.58.0 export
   that resolves neither header. Sharing one map would hide that case, because cellNum()
   reads 0 for a missing column and 0 means "no current tariff" (Kein Tarif). */
const HONOLD_COLS_FRT = { ...HONOLD_COLS, vkg_dl: 54, fr_tar: 56 };
const HONOLD_COLS_FRT_ZZ = { ...HONOLD_COLS_FRT, zz: 55 };
/* resolveHonold finds its columns in the header rows (2 and 3) of the sheet, so the
   resolver test needs a sheet with headers, not just a data row. */
const SHEET_RANGE = { s: { r: 0, c: 0 }, e: { r: 3, c: 60 } };
const HONOLD_OLD = 'Honold berechnet die Kosten nach dem bisherigen Tarif';
const HONOLD_DIFF = 'Differenz aufgrund abweichender Gewichte';
/* The truth's own shape when both halves are true: weight phrase first, then the
   previous-tariff phrase, joined with the catalog separator (20382640 rows 5, 7, 9,
   12, 13 and 16). */
const HONOLD_BOTH = 'Differenz aufgrund abweichender Gewichte // Honold berechnet die Kosten nach dem bisherigen Tarif';
const REF_TIERS = JSON.parse(readFileSync(
  new URL('./fixtures/honold-20379045-rows.json', import.meta.url), 'utf8')).tiers;
/* The rule needs the OLD tariff's zone rates, which are business data. This matrix
   carries only the reference amounts the unit cases name, at their real Bis-bracket
   indices; every other bracket stays null and therefore never matches. */
function refZone(byIndex) {
  const zone = new Array(REF_TIERS.length).fill(null);
  for (const [i, v] of Object.entries(byIndex)) zone[Number(i)] = v;
  return zone;
}
/* AT is flat at 918.88 from 6500 kg up, so that one rate sits in eight brackets. */
const AT_REF = refZone({
  8: 103.2, 10: 127.25, 11: 143.14, 17: 335.28,
  36: 918.88, 37: 918.88, 38: 918.88, 39: 918.88, 40: 918.88, 41: 918.88, 42: 918.88, 43: 918.88,
});
const HONOLD_SYNTH = {
  tiers: REF_TIERS,
  zones: {
    'AT1 Österreich': AT_REF,
    'AT2 Österreich': AT_REF,
    'CH1 Schweiz': refZone({ 10: 139.95 }),
    'CH2 Schweiz': refZone({ 26: 736.87 }),
    'CH3 Schweiz': refZone({ 3: 83.97 }),
    'SK Slowakei': refZone({ 2: 56.34 }),
    'CZ Tschechien': refZone({ 3: 46.88 }),
    /* IT@450 is 96.13 in the real OLD matrix, and 96.13 is also the current tariff at
       250 kg (20382640 row 4's FR Kosten lt. Tarif), so this lane is where the
       divergence proxy has to stay quiet. Two brackets so the FR can come from the
       other one. */
    'IT1 Italien': refZone({ 3: 41.36, 8: 96.13 }),
  },
  codes: {
    AT: ['AT1 Österreich', 'AT2 Österreich'],
    CH: ['CH1 Schweiz', 'CH2 Schweiz', 'CH3 Schweiz'],
    SK: ['SK Slowakei'],
    CZ: ['CZ Tschechien'],
    IT: ['IT1 Italien'],
  },
};
e.setHonoldTariff(HONOLD_SYNTH);
/* The real matrix (zones plus country codes) is local-only business data: the harness
   loads assets/honold-tariff.js when it is on disk and leaves this null otherwise.
   The workbook replays need it to resolve zone rates, so where it is absent they
   skip rather than pretending to pass. */
const REAL_HONOLD = e.HONOLD_TARIFF;

test('resolveHonold: resolves Volumen kg DL and FR Kosten lt. Tarif, and reports an absent header as -1', () => {
  /* A ZZ cost group is a row-2 label with a row-3 sub-label, so the resolver finds
     it the same way it finds FR / Kosten DL. Empf.-Land selects the OLD-tariff zone
     columns. 1.58.0 reads the DL weight and the row's own tariff cost again, so both
     headers resolve when the sheet carries them and -1 when it does not (that -1 is
     what keeps the two new arms off on a pre-1.58.0 layout). */
  const headers = { 12: 'Kosten DL', 20: 'Differenz',
                    22: 'Volumen kg', 23: 'Volumen kg DL', 24: 'Empf.-Land', 25: 'Kosten lt. Tarif' };
  const withZZ = makeRow(1, { 0: 'Anmerkung', 10: 'Stat_Freigabe', 12: 'FR', 20: 'ZZ', 25: 'FR' });
  Object.assign(withZZ, makeRow(2, headers));
  const withoutZZ = makeRow(1, { 0: 'Anmerkung', 10: 'Stat_Freigabe', 12: 'FR', 25: 'FR' });
  Object.assign(withoutZZ, makeRow(2, headers));
  const cols = e.resolveHonold(withZZ, SHEET_RANGE);
  assert.equal(cols.zz, 20);
  assert.equal(cols.vkg, 22);
  assert.equal(cols.vkg_dl, 23);
  assert.equal(cols.empf_land, 24);
  assert.equal(cols.fr_tar, 25);
  assert.equal(e.resolveHonold(withoutZZ, SHEET_RANGE).zz, -1);
  /* A pre-1.58.0 export: no FR Kosten lt. Tarif header anywhere. */
  const noTarif = makeRow(1, { 0: 'Anmerkung', 10: 'Stat_Freigabe', 12: 'FR' });
  Object.assign(noTarif, makeRow(2, { 12: 'Kosten DL',
                                      22: 'Volumen kg', 23: 'Volumen kg DL', 24: 'Empf.-Land' }));
  const old = e.resolveHonold(noTarif, SHEET_RANGE);
  assert.equal(old.fr_tar, -1, 'an absent FR Kosten lt. Tarif column must not resolve');
  assert.equal(old.vkg_dl, 23);
});

test('processHonold: without the decrypted tariff the row is skipped (null), never blanked', () => {
  e.setHonoldTariff(null);
  try {
    const ws = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT' });
    assert.equal(e.processHonold(ws, R, HONOLD_COLS), null);
  } finally {
    e.setHonoldTariff(HONOLD_SYNTH);
  }
});

test('processHonold: an incomplete tariff (tiers only, or empty containers) is skipped (null), not a difference note', () => {
  /* A decrypted payload that lost its zone matrix cannot answer the rule. Reading it
     would fall every row through to "abweichender Gewichte" and overwrite notes the
     engine cannot re-derive, so the predicate checks content, not truthiness:
     scripts/honold/build_tariff.py skips all-null zone columns, so a headers-only
     sheet decrypts to empty containers rather than to missing keys. */
  const ws = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT' });
  const unusable = {
    'tiers only, no zones/codes': { tiers: REF_TIERS },
    'empty containers': { tiers: [], zones: {}, codes: {} },
    'no zone arrays and no codes': { tiers: [50, 100], zones: {}, codes: {} },
    'codes with an empty zone list': { tiers: [50, 100], zones: { x: [10, 20] }, codes: { AT: [] } },
    'zone array shorter than tiers': {
      tiers: [50, 100, 500],
      zones: { 'AT1 Österreich': [127.25, 143.14] },
      codes: { AT: ['AT1 Österreich'] },
    },
    /* Length alone is not enough: a zone of nulls carries no rate to match, and a
       lower-case country key is one processHonold never looks up (it upper-cases
       the cell, not the map key), so both fall every row to a weight difference. */
    'zone array with no rate': {
      tiers: [50, 100],
      zones: { 'AT1 Österreich': [null, null] },
      codes: { AT: ['AT1 Österreich'] },
    },
    'lower-case country key': {
      tiers: [50, 100],
      zones: { 'AT1 Österreich': [127.25, 143.14] },
      codes: { at: ['AT1 Österreich'] },
    },
  };
  try {
    for (const [name, tariff] of Object.entries(unusable)) {
      e.setHonoldTariff(tariff);
      assert.equal(e.honoldTariff(), null, name);
      assert.equal(e.processHonold(ws, R, HONOLD_COLS), null, name);
    }
  } finally {
    e.setHonoldTariff(HONOLD_SYNTH);
  }
});

test('processHonold: Stat_Freigabe != 10 returns null', () => {
  const ws = makeRow(R, { 50: 5, 51: '127.25', 52: '600', 53: 'AT' });
  assert.equal(e.processHonold(ws, R, HONOLD_COLS), null);
});

test('processHonold: FR equals the OLD rate of the bracket the Volumen kg falls in -> previous-tariff note', () => {
  // AT@600 is 127.25 and 600 kg sits in bracket 10.
  const ws = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT' });
  assert.equal(e.processHonold(ws, R, HONOLD_COLS), HONOLD_OLD);
});

test('processHonold: the same rate at a weight in another bracket -> weight-difference note', () => {
  // 127.25 is the bracket-10 rate; 300 kg is bracket 5, where AT publishes nothing.
  const ws = makeRow(R, { 50: 10, 51: '127.25', 52: '300', 53: 'AT' });
  assert.equal(e.processHonold(ws, R, HONOLD_COLS), HONOLD_DIFF);
});

test('processHonold: a rate published in several brackets matches on any of them', () => {
  // AT is flat at 918.88 from 6500 to 10000 kg (brackets 36-43), so a single-index
  // lookup would only ever find bracket 36.
  for (const kg of ['6500', '8000', '10000']) {
    const ws = makeRow(R, { 50: 10, 51: '918.88', 52: kg, 53: 'AT' });
    assert.equal(e.processHonold(ws, R, HONOLD_COLS), HONOLD_OLD, `${kg} kg`);
  }
  const below = makeRow(R, { 50: 10, 51: '918.88', 52: '4500', 53: 'AT' });
  assert.equal(e.processHonold(below, R, HONOLD_COLS), HONOLD_DIFF);
});

test('processHonold: every zone of the destination country is a candidate', () => {
  // AT publishes two zones with the same rates and CH three with different ones;
  // the CH amounts below sit in three different brackets.
  const ch1 = makeRow(R, { 50: 10, 51: '139.95', 52: '600', 53: 'CH' });
  const ch2 = makeRow(R, { 50: 10, 51: '736.87', 52: '2400', 53: 'CH' });
  const ch3 = makeRow(R, { 50: 10, 51: '83.97', 52: '200', 53: 'CH' });
  assert.equal(e.processHonold(ch1, R, HONOLD_COLS), HONOLD_OLD);
  assert.equal(e.processHonold(ch2, R, HONOLD_COLS), HONOLD_OLD);
  assert.equal(e.processHonold(ch3, R, HONOLD_COLS), HONOLD_OLD);
});

test('processHonold: half a cent of rate rounding still matches, a hair more does not', () => {
  const inside = makeRow(R, { 50: 10, 51: '127.2525', 52: '600', 53: 'AT' });
  const outside = makeRow(R, { 50: 10, 51: '127.2575', 52: '600', 53: 'AT' });
  assert.equal(e.processHonold(inside, R, HONOLD_COLS), HONOLD_OLD);
  assert.equal(e.processHonold(outside, R, HONOLD_COLS), HONOLD_DIFF);
});

test('processHonold: an FR that is the OLD rate of its own bracket wins over the DL weight', () => {
  /* 2026-10-20 owner ruling: the own-bracket rate match decides the note and
     suppresses the weight half, whatever Volumen kg DL says. 600 kg is bracket 10, so
     999 kg (bracket 14) and 50 kg (bracket 0) each sit in a different one and would
     otherwise satisfy the DL-weight arm. */
  const heavier = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 54: '999', 56: '120' });
  const lighter = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 54: '50', 56: '120' });
  assert.equal(e.processHonold(heavier, R, HONOLD_COLS_FRT), HONOLD_OLD);
  assert.equal(e.processHonold(lighter, R, HONOLD_COLS_FRT), HONOLD_OLD);
});

test('processHonold: 20382640 row 5 shape (FR at another bracket, DL weight in a third, tariff diverged) -> both phrases', () => {
  /* AT publishes 127.25 at bracket 10 and 103.2 at bracket 8. The FR is the bracket-8
     rate while Volumen kg (600) sits in bracket 10, Volumen kg DL (400) in 7, and the
     row's own tariff cost (120.00) differs from every OLD rate at bracket 10 - the
     shape of 20382640 rows 5, 7, 9, 12, 13 and 16. Truth is both phrases, weight
     first. */
  const ws = makeRow(R, { 50: 10, 51: '103.2', 52: '600', 53: 'AT', 54: '400', 56: '120.00' });
  assert.equal(e.processHonold(ws, R, HONOLD_COLS_FRT), HONOLD_BOTH);
});

test('processHonold: equal Volumen kg / Volumen kg DL brackets keep the weight phrase (no third arm)', () => {
  /* 590 kg and 600 kg are both bracket 10, so the DL weight adds nothing even though
     the FR is an OLD rate from bracket 17 and the lane diverged. The note falls to
     the old fallback, not to an empty string: the DL weight only CONFIRMS a second
     bracket, it is not a reason on its own. */
  const ws = makeRow(R, { 50: 10, 51: '335.28', 52: '590', 53: 'AT', 54: '600', 56: '120.00' });
  assert.equal(e.processHonold(ws, R, HONOLD_COLS_FRT), HONOLD_DIFF);
});

test('processHonold: FR Kosten lt. Tarif of 0 / blank -> Kein Tarif for the country, terminal', () => {
  /* 20382640 row 8: SI is in the zone table but the current tariff prices no SI lane,
     so the row's own tariff cost is 0. The note is the truth's exact string, quotes
     included, and it does not read Volumen kg or the OLD matrix. */
  const blank = makeRow(R, { 50: 10, 51: '733.31', 52: '727', 53: 'si ', 54: '0' });
  const zero = makeRow(R, { 50: 10, 51: '733.31', 52: '727', 53: 'si ', 54: '0', 56: '0' });
  assert.equal(e.processHonold(blank, R, HONOLD_COLS_FRT), "Kein Tarif für 'SI'");
  assert.equal(e.processHonold(zero, R, HONOLD_COLS_FRT), "Kein Tarif für 'SI'");
  /* The wording is the one valid Dachser template, but only with the quotes: the
     engine writes its own string into the workbook, so the quote-less form would be a
     one-cell diff on every such row. */
  assert.equal(e.phraseToKey("Kein Tarif für 'SI'"), 'tpl_keinTarifLand');
  assert.equal(e.samePhraseSet(["Kein Tarif für 'SI'"], ['Kein Tarif für SI']), false,
    'the quoted and unquoted forms are different phrases');
  /* Terminal: a row that the OLD matrix would call previous tariff still reads KEIN. */
  const wouldBeOld = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 54: '999', 56: '0' });
  assert.equal(e.processHonold(wouldBeOld, R, HONOLD_COLS_FRT), "Kein Tarif für 'AT'");
});

test('processHonold: Kein Tarif does not need Volumen kg, but loses to the FR/ZZ branch and the Stat gate', () => {
  /* The branch sits after the blank / 0-FR block and before the Volumen kg gate,
     because it reads neither. 20382640 row 8 happens to carry a weight; a row
     without one takes the same note. */
  const noWeight = makeRow(R, { 50: 10, 51: '733.31', 53: 'SI', 56: '0' });
  const zeroWeight = makeRow(R, { 50: 10, 51: '733.31', 52: '0', 53: 'SI', 56: '0' });
  assert.equal(e.processHonold(noWeight, R, HONOLD_COLS_FRT), "Kein Tarif für 'SI'");
  assert.equal(e.processHonold(zeroWeight, R, HONOLD_COLS_FRT), "Kein Tarif für 'SI'");
  /* 20381523 row 4 shape: blank FR with a ZZ fee is a second delivery attempt, and
     that branch runs first. */
  const secondDelivery = makeRow(R, { 50: 10, 52: '157', 53: 'AT', 55: 35.08, 56: '0' });
  const zeroFr = makeRow(R, { 50: 10, 51: '0', 52: '157', 53: 'AT', 55: 35.08, 56: '0' });
  assert.equal(e.processHonold(secondDelivery, R, HONOLD_COLS_FRT_ZZ), '2. Zustellung');
  assert.equal(e.processHonold(zeroFr, R, HONOLD_COLS_FRT_ZZ), '2. Zustellung');
  /* Stat_Freigabe 30 is not released for a note, whatever the tariff cost says. */
  const notReleased = makeRow(R, { 50: 30, 51: '733.31', 52: '727', 53: 'SI', 56: '0' });
  assert.equal(e.processHonold(notReleased, R, HONOLD_COLS_FRT), null);
});

test('processHonold: an absent FR Kosten lt. Tarif column turns off both new arms', () => {
  /* cellNum() reads 0 for c<0, and 0 is the KEIN signal, so without the cols.fr_tar>=0
     guard every in-scope row with a country would read Kein Tarif. The BOTH shape
     must fall back to the weight phrase and the KEIN shape must keep its
     previous-tariff reading. */
  const both = makeRow(R, { 50: 10, 51: '103.2', 52: '600', 53: 'AT', 54: '400' });
  const kein = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 54: '999' });
  assert.equal(e.processHonold(both, R, HONOLD_COLS), HONOLD_DIFF, 'legacy map, BOTH row');
  assert.equal(e.processHonold(kein, R, HONOLD_COLS), HONOLD_OLD, 'legacy map, KEIN row');
  /* vkg_dl present but fr_tar absent: the DL weight alone cannot promote a row. */
  const vdlOnly = { ...HONOLD_COLS, vkg_dl: 54, fr_tar: -1 };
  assert.equal(e.processHonold(both, R, vdlOnly), HONOLD_DIFF);
  assert.equal(e.processHonold(kein, R, vdlOnly), HONOLD_OLD);
});

test('processHonold: Volumen kg DL 0, absent and present - weight, weight, both', () => {
  /* 20382640 row 11 is the real-corpus 0 case: the FR matched an OLD rate from another
     bracket and the DL weight is 0, so the row stays weight-only. Here FR 103.2 is
     AT@bracket 8 while Volumen kg 600 sits in bracket 10. The absent column reads the
     same. Only a present, non-zero weight in another bracket plus a diverged lane
     promotes the row. */
  const zero = makeRow(R, { 50: 10, 51: '103.2', 52: '600', 53: 'AT', 54: '0', 56: '120.00' });
  const present = makeRow(R, { 50: 10, 51: '103.2', 52: '600', 53: 'AT', 54: '400', 56: '120.00' });
  assert.equal(e.processHonold(zero, R, HONOLD_COLS_FRT), HONOLD_DIFF);
  assert.equal(e.processHonold(present, R, { ...HONOLD_COLS_FRT, vkg_dl: -1 }), HONOLD_DIFF);
  assert.equal(e.processHonold(present, R, HONOLD_COLS_FRT), HONOLD_BOTH);
});

test('processHonold: the divergence test is a tolerance on the row tariff, not exact equality', () => {
  /* 20382640 row 4 is the contrast: IT@450 is 96.13, the current tariff also prices
     96.13 at 250 kg, and that row stays weight-only. Here the OLD rate at bracket 8 is
     96.13 and the row's tariff cost is fed in: a tenth of a cent of rounding (96.131)
     is still the same rate, ten cents (96.14) is a different one. Deliberately not the
     0.005 boundary - that edge is an IEEE comparison artefact, not a business rule. */
  const row = (frt) => makeRow(R, { 50: 10, 51: '41.36', 52: '450', 53: 'IT', 54: '200', 56: frt });
  assert.equal(e.processHonold(row('96.13'), R, HONOLD_COLS_FRT), HONOLD_DIFF);
  assert.equal(e.processHonold(row('96.131'), R, HONOLD_COLS_FRT), HONOLD_DIFF);
  assert.equal(e.processHonold(row('96.14'), R, HONOLD_COLS_FRT), HONOLD_BOTH);
});

test('processHonold: a workbook-controlled country key cannot throw, even with the tariff column present', () => {
  /* Empf.-Land is a cell, so it can read "toString" or "__proto__". Those names
     reached an inherited non-iterable through the zone-list lookup, and runRules()
     has no try/catch, so one bad cell aborted the whole run. The tariff column is
     non-zero here so the lookup is actually reached instead of short-circuiting
     into Kein Tarif. */
  for (const land of ['toString', '__proto__', 'constructor', 'valueOf']) {
    const ws = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: land, 54: '999', 56: '120.00' });
    assert.equal(e.processHonold(ws, R, HONOLD_COLS_FRT), HONOLD_DIFF, land);
  }
});

test('processHonold: a locked tariff skips a Kein-Tarif row too (null), it does not decide it', () => {
  /* Kein Tarif reads only FR Kosten lt. Tarif and the country, but the tariff gate
     stays first: the engine must not write a note it cannot re-derive once the
     matrix is unlocked. */
  const ws = makeRow(R, { 50: 10, 51: '733.31', 52: '727', 53: 'SI', 56: '0' });
  e.setHonoldTariff(null);
  try {
    assert.equal(e.processHonold(ws, R, HONOLD_COLS_FRT), null);
  } finally {
    e.setHonoldTariff(HONOLD_SYNTH);
  }
});

test('processHonold: no zone column for the destination country -> weight-difference note', () => {
  const unknown = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'XX' });
  const blank = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: '' });
  const noColumn = makeRow(R, { 50: 10, 51: '127.25', 52: '600' });
  assert.equal(e.processHonold(unknown, R, HONOLD_COLS), HONOLD_DIFF);
  assert.equal(e.processHonold(blank, R, HONOLD_COLS), HONOLD_DIFF);
  /* A real layout without the column: HONOLD_COLS has empf_land at 53, so passing it
     would make this the same state as "blank" and the case could not fail alone. */
  assert.equal(e.processHonold(noColumn, R, { ...HONOLD_COLS, empf_land: -1 }), HONOLD_DIFF);
});

test('processHonold: a workbook-controlled country key cannot throw on a legacy layout (no tariff column)', () => {
  /* Same guard, absent-column path: without cols.fr_tar the zone lookup is still the
     place a hostile land value lands, and it must not throw there either. */
  for (const land of ['toString', '__proto__', 'constructor', 'valueOf']) {
    const ws = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: land });
    assert.equal(e.processHonold(ws, R, HONOLD_COLS), HONOLD_DIFF, land);
  }
});

test('processHonold: the country is trimmed and upper-cased before the lookup', () => {
  const lower = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: ' at ' });
  assert.equal(e.processHonold(lower, R, HONOLD_COLS), HONOLD_OLD);
});

test('processHonold: blank / 0 FR -> weight-difference note', () => {
  const blank = makeRow(R, { 50: 10, 52: '600', 53: 'AT' });
  const zero = makeRow(R, { 50: 10, 51: '0', 52: '600', 53: 'AT' });
  assert.equal(e.processHonold(blank, R, HONOLD_COLS), HONOLD_DIFF);
  assert.equal(e.processHonold(zero, R, HONOLD_COLS), HONOLD_DIFF);
});

test('processHonold: missing / 0 Volumen kg -> weight-difference note', () => {
  const missing = makeRow(R, { 50: 10, 51: '127.25', 53: 'AT' });
  const zero = makeRow(R, { 50: 10, 51: '127.25', 52: '0', 53: 'AT' });
  assert.equal(e.processHonold(missing, R, HONOLD_COLS), HONOLD_DIFF);
  assert.equal(e.processHonold(zero, R, HONOLD_COLS), HONOLD_DIFF);
});

test('processHonold: 20381523 row 44 (FR 143.14 = AT@700, 337 kg, Volumen kg DL 0) -> weight-difference note', () => {
  /* The FR is an OLD-tariff rate, but for bracket 11; 337 kg is bracket 6. The DL
     weight is 0, so the 1.58.0 arm cannot promote the row either. */
  const ws = makeRow(R, { 50: 10, 51: '143.14', 52: '337', 53: 'AT', 54: '0', 56: '77.95' });
  assert.equal(e.processHonold(ws, R, HONOLD_COLS_FRT), HONOLD_DIFF);
});

test('processHonold: 20379045 row 90 (FR 335.28 = AT@1300, 447 kg, Volumen kg DL 0) -> weight-difference note', () => {
  // The one 20379045 cell the 2026-10-20 ruling flipped: 447 kg is bracket 8.
  const ws = makeRow(R, { 50: 10, 51: '335.28', 52: '447', 53: 'AT', 54: '0', 56: '90.88' });
  assert.equal(e.processHonold(ws, R, HONOLD_COLS_FRT), HONOLD_DIFF);
});

test('collectInputsForRow: Honold exports the zone inputs, the DL weight and the row tariff', () => {
  const row = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 54: '999', 55: 35.08, 56: '120' });
  const inputs = e.collectInputsForRow('honold', row, R, HONOLD_COLS_FRT_ZZ);
  assert.equal(inputs.fr_dl, '127.25');
  assert.equal(inputs.vkg, '600');
  assert.equal(inputs.empf_land, 'AT');
  assert.equal(inputs.zz_diff, '35.08');
  assert.equal(inputs.vkg_dl, '999');
  assert.equal(inputs.fr_tarif, '120');
  /* A pre-1.58.0 layout resolves neither column, so the keys stay absent rather than
     exporting an empty string that a training consumer would read as a real 0. */
  const legacy = e.collectInputsForRow('honold', row, R, HONOLD_COLS_ZZ);
  assert.ok(!('vkg_dl' in legacy), 'an absent Volumen kg DL column is not an input');
  assert.ok(!('fr_tarif' in legacy), 'an absent FR Kosten lt. Tarif column is not an input');
});

test('rowUid: the two inputs 1.58.0 added stay out of the Honold uid seed', () => {
  /* A uid seeds on the collected inputs, so hashing the two newly-read cells would
     re-key every historical Honold training row. Both are in
     UID_EXCLUDED_INPUT_KEYS_BY_FW.honold, so a row minted before 1.58.0 keeps its uid. */
  const row = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 54: '999', 56: '120' });
  const inputs = e.collectInputsForRow('honold', row, R, HONOLD_COLS_FRT);
  const legacySeed = { stat: '10', fr_dl: '127.25', vkg: '600', empf_land: 'AT' };
  assert.equal(e.rowUid('honold', 'Sheet1', 5, inputs),
    e.rowUid('honold', 'Sheet1', 5, legacySeed));
  assert.equal(
    e.rowUid('honold', 'Sheet1', 5, { ...legacySeed, vkg_dl: '999', fr_tarif: '120' }),
    e.rowUid('honold', 'Sheet1', 5, legacySeed));
  assert.notEqual(e.rowUid('honold', 'Sheet1', 5, inputs),
    e.rowUid('honold', 'Sheet1', 5, { ...legacySeed, vkg: '601' }));
});

test('processHonold: ZZ Differenz with blank FR -> 2. Zustellung (20381523 row 4, 157 kg, ZZ 35.08)', () => {
  // The ZZ cost line is a second delivery attempt billed on its own, so its
  // Differenz decides the note on a row that carries no freight.
  const ws = makeRow(R, { 50: 10, 52: '157', 55: 35.08 });
  assert.equal(e.processHonold(ws, R, HONOLD_COLS_ZZ), '2. Zustellung');
  // A layout with no FR Kosten DL column resolves fr_dl to -1. There is no blank / 0
  // FR to read, and 1.53.0 (no ZZ branch at all) returned the weight note for such a
  // row, so the branch stays off rather than inventing a fee from a missing column.
  const noFrCol = makeRow(R, { 50: 10, 52: '157', 55: 35.08 });
  assert.equal(e.processHonold(noFrCol, R, { ...HONOLD_COLS_ZZ, fr_dl: -1 }), HONOLD_DIFF);
});

test('processHonold: a sheet without a ZZ group is unchanged', () => {
  // 20379045 and every earlier Honold layout have no ZZ row-2 label, so
  // resolveHonold yields -1 and the branch is off.
  const noCol = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT' });
  const minusOne = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT' });
  assert.equal(e.processHonold(noCol, R, HONOLD_COLS), HONOLD_OLD);
  assert.equal(e.processHonold(minusOne, R, { ...HONOLD_COLS, zz: -1 }), HONOLD_OLD);
});

test('processHonold: a blank or zero ZZ Differenz leaves the FR rule in charge', () => {
  const blank = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 55: '' });
  const zero = makeRow(R, { 50: 10, 51: '127.25', 52: '300', 53: 'AT', 55: 0 });
  assert.equal(e.processHonold(blank, R, HONOLD_COLS_ZZ), HONOLD_OLD);
  assert.equal(e.processHonold(zero, R, HONOLD_COLS_ZZ), HONOLD_DIFF);
});

test('processHonold: a ZZ Differenz inside the Dachser threshold does not fire', () => {
  // Same guard as the Dachser ZZ branch: |v| > T_DACHSER (0.08), sign-insensitive.
  // Blank FR, so this is the standalone-fee shape the branch is narrowed to.
  const atThreshold = makeRow(R, { 50: 10, 52: '157', 55: 0.08 });
  const over = makeRow(R, { 50: 10, 52: '157', 55: 0.09 });
  const negative = makeRow(R, { 50: 10, 52: '157', 55: -35.08 });
  assert.equal(e.processHonold(atThreshold, R, HONOLD_COLS_ZZ), HONOLD_DIFF);
  assert.equal(e.processHonold(over, R, HONOLD_COLS_ZZ), '2. Zustellung');
  assert.equal(e.processHonold(negative, R, HONOLD_COLS_ZZ), '2. Zustellung');
});

test('processHonold: the ZZ branch sits behind the tariff gate and the Stat gate', () => {
  const locked = makeRow(R, { 50: 10, 52: '157', 55: 35.08 });
  const notReleased = makeRow(R, { 50: 5, 52: '157', 55: 35.08 });
  e.setHonoldTariff(null);
  try {
    assert.equal(e.processHonold(locked, R, HONOLD_COLS_ZZ), null);
  } finally {
    e.setHonoldTariff(HONOLD_SYNTH);
  }
  assert.equal(e.processHonold(notReleased, R, HONOLD_COLS_ZZ), null);
});

test('processHonold: a freight-bearing row is decided by FR, not by the ZZ Differenz', () => {
  // The ZZ branch is narrowed to the standalone-fee shape: FR Kosten DL blank / 0.
  // 20260903 row 294 (Dachser) carries both a ZZ charge and a freight difference, so
  // a Honold row with freight reads the FR rule.
  const atRate = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 55: 35.08 });
  const otherRate = makeRow(R, { 50: 10, 51: '127.25', 52: '300', 53: 'AT', 55: 35.08 });
  assert.equal(e.processHonold(atRate, R, HONOLD_COLS_ZZ), HONOLD_OLD);
  assert.equal(e.processHonold(otherRate, R, HONOLD_COLS_ZZ), HONOLD_DIFF);
});

test('buildReason: the Honold trace carries the DL weight and the row tariff, zeros included', () => {
  const ws = makeRow(R, { 50: 10, 51: '127.25', 52: '600', 53: 'AT', 54: '999', 55: 35.08, 56: '120' });
  const reason = e.buildReason('honold', ws, R, HONOLD_COLS_FRT_ZZ);
  assert.match(reason, /FR_DL=127\.25/);
  assert.match(reason, /LAND=AT/);
  assert.match(reason, /VKG=600/);
  assert.match(reason, /ZZ=35\.08/);
  assert.match(reason, /VKG_DL=999/);
  assert.match(reason, /FR_TARIF=120/);
  assert.match(reason, /VKG=600 \| VKG_DL=999 \| FR_TARIF=120 \| LAND=AT/, reason);
  /* The two new tokens print their zeros: unlike the push() tokens they must not drop
     them, because FR_TARIF=0 IS the Kein-Tarif decision (20382640 row 8). */
  const zeros = makeRow(R, { 50: 10, 51: '733.31', 52: '727', 53: 'SI', 54: 0, 56: '' });
  const zeroReason = e.buildReason('honold', zeros, R, HONOLD_COLS_FRT);
  assert.match(zeroReason, /VKG_DL=0/);
  assert.match(zeroReason, /FR_TARIF=0/);
  /* Absent columns print neither token. */
  const legacy = e.buildReason('honold', ws, R, HONOLD_COLS_ZZ);
  assert.ok(!legacy.includes('VKG_DL'), legacy);
  assert.ok(!legacy.includes('FR_TARIF'), legacy);
  assert.ok(!e.buildReason('honold', ws, R, HONOLD_COLS).includes('ZZ='));
});

test('phrase catalog: both Honold phrases resolve to stable keys', () => {
  assert.equal(e.phraseToKey('Honold berechnet die Kosten nach dem bisherigen Tarif'),
    'honoldBisherigerTarif');
  /* The weight-difference wording already exists for Dachser/K+N, so Honold
     reuses that catalog key instead of adding a duplicate value. */
  assert.equal(e.phraseToKey('Differenz aufgrund abweichender Gewichte'),
    'abweichGewichte');
});

/* ── 20379045 Soll-Ist-Vergleich: the whole table ────────────────────────────
   The 124 rule inputs (Stat_Freigabe, FR Kosten DL, Volumen kg, Empf.-Land) and the
   workbook's own Anmerkung labels, after the 2026-10-20 owner ruling replaced the
   weight-tier comparison with the OLD-tariff rate match. Rows 4, 44 and 117 - the
   2026-10-12 workbook-error list - now agree with the sheet: that bundle's cells were
   corrected to "bisherigen" on 2026-10-12 17:22, and the 2026-10-20 ruling agrees with
   the corrected sheet instead of overturning it. The 11 cells that had
   drifted to "Differenz" and row 90 were corrected to the new rule. Mismatches: none.
   The tariff (zones, not just tiers) is local business data, so the replay skips on a
   clone without assets/honold-tariff.js. */
test('processHonold: 20379045 replay agrees on 124/124, no mismatches', (t) => {
  /* The fixture shape and its pinned outliers are asserted before the tariff gate:
     a truncated or re-keyed fixture must fail here, not pass as a quiet skip. */
  const fx = JSON.parse(readFileSync(
    new URL('./fixtures/honold-20379045-rows.json', import.meta.url), 'utf8'));
  assert.equal(fx.rows.length, 124);
  assert.deepEqual(fx.outliers, []);
  assert.ok(fx.rows.every((x) => 'vkg_dl' in x && 'fr_tarif' in x),
    'every row carries the two columns 1.58.0 reads');
  if (!REAL_HONOLD) {
    t.diagnostic('replay skipped: assets/honold-tariff.js absent');
    t.skip('assets/honold-tariff.js is not on disk');
    return;
  }
  e.setHonoldTariff(REAL_HONOLD);
  try {
    const mismatches = [];
    for (const x of fx.rows) {
      const ws = makeRow(R, { 50: x.stat, 51: x.fr_dl, 52: x.vkg, 53: x.land,
                              54: x.vkg_dl, 56: x.fr_tarif });
      if (e.processHonold(ws, R, HONOLD_COLS_FRT) !== x.truth) mismatches.push(x.row);
    }
    assert.deepEqual(mismatches, []);
  } finally {
    e.setHonoldTariff(HONOLD_SYNTH);
  }
});

/* 20381523 is the workbook that arrived with the 2026-10-19 bundle: it adds a ZZ
   cost group, and its row 4 is the standalone-ZZ row. Row 44 is the FR-rate-in-another-
   bracket row the 2026-10-20 ruling flipped, and the five cross-bracket rows 9, 12, 15,
   21 and 35 - the 2026-10-12 policy list - are previous-tariff rows in engine and sheet.
   Mismatches: none. */
test('processHonold: 20381523 replay agrees on 41/41, no mismatches', (t) => {
  const fx = JSON.parse(readFileSync(
    new URL('./fixtures/honold-20381523-rows.json', import.meta.url), 'utf8'));
  assert.equal(fx.rows.length, 41);
  assert.deepEqual(fx.outliers, []);
  assert.ok(fx.rows.every((x) => 'vkg_dl' in x && 'fr_tarif' in x),
    'every row carries the two columns 1.58.0 reads');
  if (!REAL_HONOLD) {
    t.diagnostic('replay skipped: assets/honold-tariff.js absent');
    t.skip('assets/honold-tariff.js is not on disk');
    return;
  }
  e.setHonoldTariff(REAL_HONOLD);
  try {
    const mismatches = [];
    for (const x of fx.rows) {
      const ws = makeRow(R, { 50: x.stat, 51: x.fr_dl, 52: x.vkg, 53: x.land,
                              54: x.vkg_dl, 55: x.zz, 56: x.fr_tarif });
      const out = e.processHonold(ws, R, HONOLD_COLS_FRT_ZZ);
      if (out !== x.truth) mismatches.push(x.row);
      /* The six rows the ruling moved must land on the side the sheet already
         takes: previous tariff for the five cross-bracket rows, weight difference
         for row 44 (FR 143.14 is the 700 kg rate, 337 kg is bracket 6). */
      if ([9, 12, 15, 21, 35].includes(x.row)) {
        assert.equal(out, HONOLD_OLD, `row ${x.row} engine phrase`);
        assert.equal(x.truth, HONOLD_OLD, `row ${x.row} workbook phrase`);
      }
      if (x.row === 44) {
        assert.equal(out, HONOLD_DIFF);
        assert.equal(x.truth, HONOLD_DIFF);
      }
    }
    assert.deepEqual(mismatches, []);
  } finally {
    e.setHonoldTariff(HONOLD_SYNTH);
  }
});

/* 20380293 is the oldest of the four sheets: 7 notes plus one Stat_Freigabe 30 row.
   Row 4 reads "bisherigen" because the sheet does: the 2026-10-12 bundle called that
   cell a workbook error under the old weight rule, the sheet was corrected to
   "bisherigen" on 2026-10-12 17:22, and the 2026-10-20 ruling agrees with the sheet
   (FR 46.97 is the AT rate of bracket 2, the bracket 127.661 kg falls in). Its DL
   weight (64.16 kg) does sit in bracket 1, so the own-bracket match is what keeps the
   note single-phrase - the 1.58.0 DL arm must not promote it. Inline because 8 rows
   are not worth a fixture. */
test('processHonold: 20380293 replay agrees on 7/7', (t) => {
  const rows = [
    { row: 4, stat: 10, fr_dl: 46.97, vkg: '127,661', vkg_dl: '64,16', fr_tarif: 41.36, land: 'AT', truth: HONOLD_OLD },
    { row: 5, stat: 10, fr_dl: 36.5, vkg: '63,5', vkg_dl: '63,5', fr_tarif: 32.14, land: 'AT', truth: HONOLD_OLD },
    { row: 6, stat: 30, fr_dl: 49.86, vkg: '55,21', vkg_dl: '0', fr_tarif: 49.86, land: 'ES', truth: null },
    { row: 7, stat: 10, fr_dl: 113.92, vkg: '701,07', vkg_dl: '0', fr_tarif: 118.02, land: 'CZ', truth: HONOLD_OLD },
    { row: 8, stat: 10, fr_dl: 76.97, vkg: '350,536', vkg_dl: '350,54', fr_tarif: 79.74, land: 'CZ', truth: HONOLD_OLD },
    { row: 9, stat: 10, fr_dl: 56.34, vkg: '107,1', vkg_dl: '106,4', fr_tarif: 55.45, land: 'SK', truth: HONOLD_OLD },
    { row: 10, stat: 10, fr_dl: 30.82, vkg: '83', vkg_dl: '83', fr_tarif: 31.93, land: 'CZ', truth: HONOLD_OLD },
    { row: 11, stat: 10, fr_dl: 71.86, vkg: '284,81', vkg_dl: '0', fr_tarif: 63.28, land: 'AT', truth: HONOLD_OLD },
  ];
  assert.equal(rows.filter((x) => x.truth).length, 7);
  if (!REAL_HONOLD) {
    t.diagnostic('replay skipped: assets/honold-tariff.js absent');
    t.skip('assets/honold-tariff.js is not on disk');
    return;
  }
  e.setHonoldTariff(REAL_HONOLD);
  try {
    const mismatches = [];
    for (const x of rows) {
      const ws = makeRow(R, { 50: x.stat, 51: x.fr_dl, 52: x.vkg, 53: x.land,
                              54: x.vkg_dl, 56: x.fr_tarif });
      if (e.processHonold(ws, R, HONOLD_COLS_FRT) !== x.truth) mismatches.push(x.row);
    }
    assert.deepEqual(mismatches, []);
  } finally {
    e.setHonoldTariff(HONOLD_SYNTH);
  }
});

/* 20382640 is the 2026-10-27 bundle's source pair. Every row is pinned exactly, because
   this sheet is where the two new arms were observed: rows 5, 7, 9, 12, 13 and 16 are
   the truth's both-phrase rows, 4 and 11 stay weight-only (row 4 because IT@450 96.13 is
   ALSO the current tariff at 250 kg, row 11 because Volumen kg DL is 0), 6, 14, 15, 19
   and 20 keep the previous-tariff phrase from the own-bracket match, row 8 reads Kein
   Tarif for SI, and the three Stat_Freigabe 30 rows carry no note. Mismatches: none. */
test('processHonold: 20382640 replay agrees on 17/17, no mismatches', (t) => {
  const fx = JSON.parse(readFileSync(
    new URL('./fixtures/honold-20382640-rows.json', import.meta.url), 'utf8'));
  assert.equal(fx.schema, 'honold-20382640-rows/v1');
  assert.equal(fx.source, '20382640 Soll-Ist-Vergleich.xlsx');
  assert.equal(fx.rows.length, 17);
  assert.deepEqual(fx.outliers, []);
  assert.ok(fx.rows.every((x) => 'vkg_dl' in x && 'fr_tarif' in x),
    'every row carries the two columns 1.58.0 reads');
  /* The workbook's own Anmerkung cell per row, cross-checked against the fixture so a
     hand-edit of the expected strings fails here before the tariff gate. */
  const expected = {
    4: HONOLD_DIFF, 5: HONOLD_BOTH, 6: HONOLD_OLD, 7: HONOLD_BOTH,
    8: "Kein Tarif für 'SI'", 9: HONOLD_BOTH, 10: null, 11: HONOLD_DIFF,
    12: HONOLD_BOTH, 13: HONOLD_BOTH, 14: HONOLD_OLD, 15: HONOLD_OLD,
    16: HONOLD_BOTH, 17: null, 18: null, 19: HONOLD_OLD, 20: HONOLD_OLD,
  };
  assert.deepEqual(fx.rows.map((x) => x.row), Object.keys(expected).map(Number));
  for (const x of fx.rows) assert.equal(x.truth, expected[x.row], `row ${x.row} workbook cell`);
  if (!REAL_HONOLD) {
    t.diagnostic('replay skipped: assets/honold-tariff.js absent');
    t.skip('assets/honold-tariff.js is not on disk');
    return;
  }
  e.setHonoldTariff(REAL_HONOLD);
  try {
    const mismatches = [];
    const got = new Map();
    for (const x of fx.rows) {
      const ws = makeRow(R, { 50: x.stat, 51: x.fr_dl, 52: x.vkg, 53: x.land,
                              54: x.vkg_dl, 56: x.fr_tarif });
      const out = e.processHonold(ws, R, HONOLD_COLS_FRT);
      got.set(x.row, out);
      if (out !== x.truth) mismatches.push({ row: x.row, got: out, truth: x.truth });
    }
    assert.deepEqual(mismatches, []);
    /* Per-row groups, so a future rule that lands on the right string for the wrong
       reason still has to account for each shape. */
    for (const row of [5, 7, 9, 12, 13, 16]) assert.equal(got.get(row), HONOLD_BOTH, 'row ' + row);
    for (const row of [4, 11]) assert.equal(got.get(row), HONOLD_DIFF, 'row ' + row);
    for (const row of [6, 14, 15, 19, 20]) assert.equal(got.get(row), HONOLD_OLD, 'row ' + row);
    assert.equal(got.get(8), "Kein Tarif für 'SI'", 'row 8');
    for (const row of [10, 17, 18]) assert.equal(got.get(row), null, 'row ' + row);
    /* Row 4 is the all-differ contrast: IT 39012 bills 55.76, an OLD rate at the DL
       bracket, and IT@450 is 96.13 while the row's FR Kosten lt. Tarif is ALSO 96.13 -
       the tariff at 250 kg is unchanged, so the lane did not diverge and the note stays
       the weight phrase. Asserted against the joined phrase explicitly. */
    assert.equal(got.get(4), HONOLD_DIFF, 'row 4 (IT@450 96.13) is weight-only');
    assert.notEqual(got.get(4), HONOLD_BOTH, 'row 4 must not join the previous-tariff phrase');
  } finally {
    e.setHonoldTariff(HONOLD_SYNTH);
  }
});

/* ── AI bundle v3 2026-10-08 (Dachser, Soll-Ist-Vergleich 20261006) ───────────
   Six rules, one per failure pattern in that bundle. Each asserts the new note
   AND that the neighbouring rows the rule must not touch stay put. */

test('processDachser: ZABF Differenz over threshold -> Einfuhrzollabfertigung', () => {
  // The seven Oslo rows of the 20261006 sheet all carry ZABF Kosten DL 50 /
  // ZABF Differenz 50 and list Einfuhrzollabfertigung last, after the weight
  // delta. The engine had no branch reading ZABF, so the note was dropped.
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, zabf_diff: 55,
                 maut: 56, snk_dl: 57, snk_diff: 58, snk_tar: 59, serv_art: 60 };
  const ws = makeRow(R, {
    50: 10, 51: '257.14', 52: '-97.55', 53: '277,2', 54: '93',
    55: '50', 56: '-19.68', 57: '4.76', 58: '-4.87', 59: '9.63', 60: 'DA01',
  });
  assert.equal(
    e.processDachser(ws, R, cols),
    'Differenz Laderaumkostenentwicklung // Einfuhrzollabfertigung // Mautdifferenz // Differenz aufgrund abweichender Gewichte',
  );
});

test('processDachser: ZABF Differenz of 0 stays silent', () => {
  // Row e97594be (RS import) keeps its ZABF line at 0/0/0 and expects no note.
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, zabf_diff: 55, maut: 56 };
  const ws = makeRow(R, { 50: 10, 51: '271.04', 52: '7.21', 53: '160', 54: '160', 55: '0', 56: '-10.44' });
  const out = e.processDachser(ws, R, cols);
  assert.ok(!out.includes('Einfuhrzollabfertigung'), out);
});

/* ── T1 (Transitabfertigung): 20261027 row 139 and the shapes that must stay
   silent around it. The T1 column group was mapped nowhere before 1.61.0. ── */

const T1_ROW_139_COLS = {
  stat: 50, tarif: 51, fr: 52, brutto: 53, vkg: 54, vkg_dl: 55, snk_dl: 56,
  snk_diff: 57, maut: 58, tz: 59, referenz: 60, empf_plz: 61, empf_ort: 62,
  serv_art: 63, sachkonto: 35, abg_land: 64, empf_land: 65,
  t1_dl: 66, t1_tar: 67, t1_diff: 68,
};
function t1Row139(dl, tar, diff) {
  return makeRow(R, {
    50: 10, 51: '172.18', 52: '-20.91', 53: '124', 54: '0', 55: '62',
    56: '5.92', 57: '5.92', 58: '-9.03', 59: '-0.29', 60: '1060382694',
    61: '71380', 62: 'Ilijas', 63: 'DA01', 35: 'X', 64: 'DE', 65: 'BA',
    66: dl, 67: tar, 68: diff,
  });
}

test('processDachser: T1 billed against a blank base -> Transitabfertigung, ok? after Mautdifferenz', () => {
  // 20261027 row 139 (DE -> BA Ilijas): T1 Kosten DL 50, Kosten lt. Tarif 0 on
  // the sheet (fed here as a blank cell, since the arm treats both as no base),
  // Differenz 50. The sheet puts the phrase between Mautdifferenz and the weight
  // delta, so the join position is part of the pin.
  assert.equal(
    e.processDachser(t1Row139('50', undefined, '50'), R, T1_ROW_139_COLS),
    'Differenz Laderaumkostenentwicklung // Mautdifferenz // Transitabfertigung, ok? // Differenz aufgrund abweichender Gewichte',
  );
});

test('processDachser: T1 backed at 50/50 stays silent on transit', () => {
  // 38 of the 41 T1-billed rows in the corpus carry tariff == cost, so the line
  // is billed as quoted and the auditor says nothing about it.
  assert.equal(
    e.processDachser(t1Row139('50', '50', '0'), R, T1_ROW_139_COLS),
    'Differenz Laderaumkostenentwicklung // Mautdifferenz // Differenz aufgrund abweichender Gewichte',
  );
});

test('processDachser: T1 at 100 against a 50 base stays silent on transit', () => {
  // 20260903 row 275 and 20261013 row 366 bill 100 against a 50 base and both
  // truth cells stay silent on transit, so a non-zero base switches the arm off.
  assert.equal(
    e.processDachser(t1Row139('100', '50', '50'), R, T1_ROW_139_COLS),
    'Differenz Laderaumkostenentwicklung // Mautdifferenz // Differenz aufgrund abweichender Gewichte',
  );
});

test('processDachser: T1 threshold is 0.08 exclusive and a blank or zero base is the same cell', () => {
  const cols = { stat: 50, tarif: 51, t1_dl: 52, t1_tar: 53, t1_diff: 54 };
  let ws = makeRow(R, { 50: 10, 51: '100', 52: '50', 53: '0', 54: '0.08' });
  assert.equal(e.processDachser(ws, R, cols), '', 'a difference equal to T_DACHSER is sub-threshold');
  ws = makeRow(R, { 50: 10, 51: '100', 52: '50', 53: '0', 54: '0.09' });
  assert.equal(e.processDachser(ws, R, cols), 'Transitabfertigung, ok?');
  // No tariff cell at all and an explicit numeric 0 read the same: no base.
  ws = makeRow(R, { 50: 10, 51: '100', 52: '50', 54: '50' });
  assert.equal(e.processDachser(ws, R, cols), 'Transitabfertigung, ok?');
  ws = makeRow(R, { 50: 10, 51: '100', 52: '50', 53: 0, 54: '50' });
  assert.equal(e.processDachser(ws, R, cols), 'Transitabfertigung, ok?');
});

test('processDachser: a sheet with no T1 tariff column keeps the transit arm off', () => {
  // A T1 group exported without the "Kosten lt. Tarif" column resolves that
  // column to -1, and a -1 base is unreadable rather than zero. Reading it as 0
  // would turn every billed T1 line on such a sheet into an unbacked one.
  const cols = { stat: 50, tarif: 51, t1_dl: 52, t1_tar: -1, t1_diff: 53 };
  const ws = makeRow(R, { 50: 10, 51: '100', 52: '50', 53: '50' });
  assert.equal(e.processDachser(ws, R, cols), '');
});

test('processDachser: a firing T1 line suppresses the FR !res arms', () => {
  // The T1 phrase is joined before the FR block, so a small positive FR at equal
  // weights no longer reaches the "frVal >= 0.05 && !res" branch. No corpus row
  // has this shape; the test records the interaction rather than endorsing it.
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54,
                 t1_dl: 55, t1_tar: 56, t1_diff: 57 };
  const ws = makeRow(R, {
    50: 10, 51: '100', 52: '0.5', 53: '100', 54: '100',
    55: '50', 56: '0', 57: '50',
  });
  assert.equal(e.processDachser(ws, R, cols), 'Transitabfertigung, ok?');
});

test('processDachser: empty SNK cell never becomes a Laderaumkostenentwicklung', () => {
  // Row 117b99e2 (row 10, NO) has no SNK line, but this workbook parks the SNK
  // tariff figure in the Laderaum-surcharge field, so an empty SNK used to read
  // as diff==tarif>0 and the K1AV fallback emitted Laderaumkostenentwicklung.
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, maut: 55, snk_dl: 56, snk_diff: 57, snk_tar: 58 };
  const ws = makeRow(R, { 50: 10, 51: '729.52', 52: '2724.7', 53: '864,336', 54: '8853', 55: '263.81' });
  assert.equal(e.processDachser(ws, R, cols), 'Mautdifferenz // Differenz aufgrund abweichender Gewichte');
});

test('processDachser: SNK_DL=80 K1AV -> Speditionskosten gem. Text + Admin Zeitfensterbuchung Handel', () => {
  // 23 rows of the bundle share this signature (SNK Kosten DL 80, K1AV, 612100,
  // Werne 59368). The 80 bundles the 75 Speditionskosten line with the 5 admin
  // Zeitfenster line, and the auditor names both.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '109.72', 52: '80', 53: '80', 54: '75', 55: 'K1AV' });
  assert.equal(
    e.processDachser(ws, R, cols),
    'Speditionskosten gem. Text // Admin Zeitfensterbuchung Handel',
  );
});

test('processDachser: SNK_DL=80 with a non-K1AV Serv.-Art keeps the generic Laderaum wording', () => {
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '109.72', 52: '80', 53: '80', 54: '75', 55: 'DA01' });
  assert.notEqual(e.processDachser(ws, R, cols), 'Speditionskosten gem. Text // Admin Zeitfensterbuchung Handel');
});

test('processDachser: SNK_DL=390 -> Standgeld (three 130 units)', () => {
  // Row e47bda75: SNK Kosten DL 390, SNK lt. Tarif 59.70, K1AV domestic.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54, serv_art: 55 };
  const ws = makeRow(R, { 50: 10, 51: '616.62', 52: '390', 53: '330.3', 54: '59.7', 55: 'K1AV' });
  assert.equal(e.processDachser(ws, R, cols), 'Standgeld');
});

test('processDachser: cents-bearing SNK residual does NOT accept the 0.08 boundary', () => {
  // Row 09ef3ff2 / 20261006 row 184: SNK Kosten DL 2.8, SNK Differenz 0.08, no
  // Serv.-Art. This test used to assert that 0.08 still reads
  // Laderaumkostenentwicklung. The user has ruled that row a worksheet error.
  //
  // Every row sitting exactly on 0.08 wants no leading segment: 20260917 rows
  // 124/125/126 (SNK_DL 2.72/2.64/2.64) and 20260923 row 295 (2.64). Rows at 0.10
  // and above, 20260917 rows 112-116, do want it. The earlier `>=` exemption let
  // the boundary rows through on a rounding artifact; the split is at the
  // threshold, so a residual equal to it is sub-threshold.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54 };
  const ws = makeRow(R, { 50: 10, 51: '72.28', 52: '2.8', 53: '0.08', 54: '2.72' });
  assert.equal(e.processDachser(ws, R, cols), '');
});

test('processDachser: cents-bearing SNK residual above the threshold still reads Laderaumkostenentwicklung', () => {
  // The counterexample that keeps the branch alive: 20260917 rows 112-116 carry
  // SNK_DIFF 0.10-0.16 and the sheet wants the leading segment.
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54 };
  const ws = makeRow(R, { 50: 10, 51: '72.28', 52: '3.26', 53: '0.1', 54: '3.16' });
  assert.equal(e.processDachser(ws, R, cols), 'Differenz Laderaumkostenentwicklung');
});

test('processDachser: integer SNK residual keeps the strict threshold', () => {
  // The loosened boundary is scoped to cents-bearing SNK_DL; an integer SNK_DL
  // with a sub-threshold delta stays silent (14 is the productZuschlag gate).
  const cols = { stat: 50, tarif: 51, snk_dl: 52, snk_diff: 53, snk_tar: 54 };
  const ws = makeRow(R, { 50: 10, 51: '72.28', 52: '11', 53: '0.08', 54: '10.92' });
  assert.equal(e.processDachser(ws, R, cols), '');
});

test('processDachser: blank TARIF above 10 t on a domestic lane -> Kein Tarif für DE >10 to, ok?', () => {
  // Row f027ef05: Brutto 11573, FR 566.52, MT 129.87, TZ 87.81, blank TARIF.
  // The weight rate card tops out at 10000 kg, so no tariff exists to compare.
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, maut: 55, tz: 56, sachkonto: 57, serv_art: 58 };
  const ws = makeRow(R, {
    50: 10, 52: '566.52', 53: '11573', 54: '5754', 55: '129.87', 56: '87.81',
    57: '612100', 58: 'K1AV',
  });
  assert.equal(e.processDachser(ws, R, cols), 'Kein Tarif für DE >10 to, ok?');
});

test('processDachser: blank TARIF at or below 10 t keeps the Fremdnummer fallback', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, maut: 55, sachkonto: 56, serv_art: 57, referenz: 58 };
  const ws = makeRow(R, {
    50: 10, 52: '566.52', 53: '9999', 54: '5754', 55: '129.87',
    56: '612100', 57: 'K1AV', 58: '2544805673',
  });
  assert.equal(e.processDachser(ws, R, cols), 'Fremdnummer 2544805673 bereits berechnet in RE00123xxx, ok?');
});

/* ── Amazon rows with no tariff, 20261027 rows 146-151 ─────────────────────
   The Amazon tariff card is not shipped, so the arm infers it from an Amazon
   Empf.-Name, a blank TARIF and a second delta line. Each test pins the whole
   engine string, so a wrong join or order shows up as a failure. */

const AMAZON_COLS = {
  stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, maut: 55, tz: 56,
  snk_dl: 57, snk_diff: 58, recip: 59, empf_plz: 60, empf_land: 61,
  sachkonto: 62, serv_art: 63, referenz: 64, abg_land: 65,
};

test('processDachser: Amazon recipient, blank TARIF, domestic -> kein Tarif für AMAZON DE \'37293\'', () => {
  // Row 146 (XDT6, Herleshausen 37293): FR 299.4, MT 52.82, TZ 53.89, 1794 kg.
  const ws = makeRow(R, {
    50: 10, 52: '299.4', 53: '1794,584', 54: '1795', 55: '52.82', 56: '53.89',
    59: 'Amazon - XDT6', 60: '37293', 61: 'DE', 62: '612100', 63: 'K1AV',
    64: '2545154269',
  });
  assert.equal(e.processDachser(ws, R, AMAZON_COLS), "kein Tarif für AMAZON DE '37293'");
});

test('processDachser: Amazon PL postal code keeps only its digit prefix', () => {
  // Row 151 (IPLY, Warszawa 05-500) is the row the country arm used to answer
  // with "kein Tarif für PL", so this pins both the position of the Amazon arm
  // and the token: the full PLZ would read "'05-500'".
  const ws = makeRow(R, {
    50: 10, 52: '104.7', 53: '300', 54: '300', 55: '13', 56: '18.85',
    57: '5.24', 58: '5.24', 59: 'Amazon - IPLY', 60: '05-500', 61: 'PL',
    62: '612100', 63: 'K1AV',
  });
  assert.equal(e.processDachser(ws, R, AMAZON_COLS), "kein Tarif für AMAZON PL '05'");
});

test('processDachser: the 10 t ceiling still wins over the Amazon arm', () => {
  // 20261006 row 205 (XDU5, 34474): Brutto 11573, FR 566.52, MT 129.87, TZ 87.81.
  const ws = makeRow(R, {
    50: 10, 52: '566.52', 53: '11573', 54: '5754', 55: '129.87', 56: '87.81',
    59: 'Amazon - XDU5', 60: '34474', 61: 'DE', 62: '612100', 63: 'K1AV',
  });
  assert.equal(e.processDachser(ws, R, AMAZON_COLS), 'Kein Tarif für DE >10 to, ok?');
});

test('processDachser: an Amazon row with no second delta keeps the Fremdnummer literal', () => {
  // 20260923 row 193 (DTM1, 59368): FR 75, no MT/TZ/EXP, SACH 612100 + K1AV.
  const ws = makeRow(R, {
    50: 10, 52: '75', 53: '2623', 54: '2623', 59: 'Amazon - DTM1', 60: '59368',
    61: 'DE', 62: '612100', 63: 'K1AV', 64: '2544567001',
  });
  assert.equal(
    e.processDachser(ws, R, AMAZON_COLS),
    'Fremdnummer 2544567001 bereits berechnet in RE00123xxx, ok?',
  );
});

test('processDachser: an Amazon row with a blank Empf.-Land keeps the Fremdnummer literal', () => {
  // Kills dropping empfLand from the Amazon guard: the arm would then fire on an
  // empty country and emit "kein Tarif für AMAZON  '37293'".
  const ws = makeRow(R, {
    50: 10, 52: '299.4', 53: '1794,584', 54: '1795', 55: '52.82', 56: '53.89',
    59: 'Amazon - XDT6', 60: '37293', 62: '612100', 63: 'K1AV',
    64: '2545154269', 65: 'DE',
  });
  const out = e.processDachser(ws, R, AMAZON_COLS);
  assert.equal(out, 'Fremdnummer 2545154269 bereits berechnet in RE00123xxx, ok?');
  assert.ok(!out.includes('AMAZON'), out);
});

test('processDachser: the Abg.-Land import arm wins over the Amazon arm', () => {
  // Kills moving the Amazon arm above the import-country arm: a PL departure
  // with a DE destination would then read "kein Tarif für AMAZON DE '05'".
  const ws = makeRow(R, {
    50: 10, 52: '104.7', 53: '300', 54: '300', 55: '13', 56: '18.85',
    59: 'Amazon - IPLY', 60: '05-500', 61: 'DE', 62: '612100', 63: 'K1AV',
    65: 'PL',
  });
  assert.equal(e.processDachser(ws, R, AMAZON_COLS), 'kein Tarif für PL');
});

test('processDachser: an Amazon row without a numeric PLZ token falls through to the country arm', () => {
  // A GB postcode has no leading digits, so the arm must not emit a token-less
  // "... AMAZON GB ''" and the country arm answers instead.
  const ws = makeRow(R, {
    50: 10, 52: '120', 53: '500', 54: '500', 55: '20',
    59: 'Amazon - BHX1', 60: 'AB1 2CD', 61: 'GB', 62: '612100', 63: 'K1AV',
  });
  assert.equal(e.processDachser(ws, R, AMAZON_COLS), 'kein Tarif für GB');
});

test('processDachser: a non-Amazon recipient on a blank TARIF export keeps the country arm', () => {
  // Kills a gate that drops the recipient test: DE -> RO with SACH + SERV.
  const ws = makeRow(R, {
    50: 10, 52: '1783.7', 53: '4200', 54: '4200', 55: '40',
    59: 'Contoso GmbH', 60: '010101', 61: 'RO', 62: '612100', 63: 'K1AV',
  });
  assert.equal(e.processDachser(ws, R, AMAZON_COLS), 'kein Tarif für RO');
});

test('processDachser: FR wording comes from the rate cards, not the EXP lane proxy', () => {
  /* Was: DE origin + non-DE destination + EXP over threshold -> Sonderfahrt.
     That proxy matched 1 of the 5 Sonderfahrt rows on 20260923 and 7 of 15 on
     20260917. It is replaced by the two card comparisons below. */
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, abg_land: 55,
                 empf_land: 56, fr_dl: 57, fr_tar: 58 };
  const real = e.DACHSER_RATECARDS;
  const needs = !!real;

  if (needs) {
    /* 20260923 row 296: DE -> PL, kg 639, FR_DL 340.9. 340.9 - 150 = 190.90,
       and the NEW card's PL2 at 601-700 is 190.94 (delta 0.04 — the rounding
       the auditor leaves, so the match is a 0.5 tolerance, not equality). */
    let ws = makeRow(R, { 50: 10, 51: '98.91', 52: '155.52', 53: '639', 54: '639',
                          55: 'DE', 56: 'PL', 57: '340.9', 58: '185.38' });
    assert.equal(e.processDachser(ws, R, cols), 'Sonderfahrt');

    /* 20260923 row 5: DE -> FR, kg 44, FR_DL 73.3 / FR_Tar 71.13. No S fits, so
       it is not a Sonderfahrt; FR_Tar 71.13 is an exact OLD-card FR2 hit. */
    ws = makeRow(R, { 50: 10, 51: '98.91', 52: '2.17', 53: '44', 54: '44',
                      55: 'DE', 56: 'FR', 57: '73.3', 58: '71.13' });
    assert.equal(e.processDachser(ws, R, cols), 'Dachser berechnet die Kosten nach dem bisherigen Tarif');

    /* 20260923 row 384: CH -> DE import, kg 40, FR_Tar 86.77. The OLD card's CH1
       at 1-50 is 75.45; 75.45 x 1.15 = 86.77 exactly. The x1.15 import
       increment applies on imports only, which this row is. */
    ws = makeRow(R, { 50: 10, 51: '98.91', 52: '4.33', 53: '40', 54: '40',
                      55: 'CH', 56: 'DE', 57: '91.1', 58: '86.77' });
    assert.equal(e.processDachser(ws, R, cols), 'Dachser berechnet die Kosten nach dem bisherigen Tarif');
  }
});

/* ── Dachser FR wording: the full ratecard table ──────────────────────────────
   The three production sheets carry 50 rows the auditor marks Sonderfahrt or
   "bisherigen Tarif". The fixture is those rows' inputs (country pair, weight,
   FR_DL, FR_Tar, FR Differenz) plus the verdict the user confirmed. It pins the
   whole table so a future card regeneration or a tolerance tweak cannot quietly
   move a row, and it documents the 13 rows where the sheet's own wording is
   wrong (marked SF here, confirmed by the user against the cards).

   Skipped when the local ratecard plaintext is absent: a plain clone ships only
   the encrypted bundle, so the fixture cannot be evaluated there. */
test('processDachser: Sonderfahrt / bisherigen matches the confirmed 50-row table', {
  skip: e.DACHSER_RATECARDS ? false : 'needs the local plaintext Dachser ratecard',
}, () => {
  const rows = JSON.parse(
    readFileSync(new URL('./fixtures/dachser-sonderfahrt-rows.json', import.meta.url), 'utf8'));
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, abg_land: 55,
                 empf_land: 56, fr_dl: 57, fr_tar: 58 };
  const SF = 'Sonderfahrt';
  const BS = 'Dachser berechnet die Kosten nach dem bisherigen Tarif';
  const mismatches = [];
  for (const x of rows) {
    const ws = makeRow(R, {
      3: '1', 13: '00000', 14: 'X', 50: 10, 51: '98.91',
      52: String(x.fr_diff ?? 1),
      53: String(x.kg), 54: String(x.kg),
      55: x.abg, 56: x.empf,
      57: String(x.fr_dl ?? 0), 58: String(x.fr_tar ?? 0),
    });
    const out = String(e.processDachser(ws, R, cols) || '');
    const got = out.includes(SF) ? 'SF' : (out.includes(BS) ? 'BS' : 'OTHER');
    if (got !== x.truth) {
      mismatches.push(`${x.tag} r${x.row} ${x.abg}->${x.empf} kg${x.kg} DL=${x.fr_dl} TAR=${x.fr_tar} want=${x.truth} got=${got}`);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('\n'));
});

test('processDachser: DA_SONDERFAHRT_S carries the 110 add-on', () => {
  /* Pure code, so this runs on a card-less clone too: dropping 110 from the
     set must fail here even when the 20261019 row 201 card test is skipped.
     The order is pinned as well, so a reshuffle has to be deliberate. */
  const set = e.evalInContext('DA_SONDERFAHRT_S');
  assert.ok(set.includes(110), 'DA_SONDERFAHRT_S must carry the 110 add-on');
  assert.deepEqual(Array.from(set), [180, 150, 120, 90, 110]);
});

test('processDachser: the 110 Sonderfahrt add-on is pinned by 20261019 row 201', {
  skip: e.DACHSER_RATECARDS ? false : 'needs the local plaintext Dachser ratecard',
}, () => {
  /* Row 201 is the only witness for 110: FR_DL 162.70 minus 110 leaves 52.70,
     which lands on the NEW PL1 lane 52.71 (0.5 tolerance). Drop 110 from the
     set and the row falls through to FR_Tar 51.17, an exact OLD PL1 hit, so it
     reports the bisherigen wording instead. */
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg: 54, vkg_dl: 55,
                 abg_land: 56, empf_land: 57, fr_dl: 58, fr_tar: 59, maut: 60 };
  const ws = makeRow(R, {
    50: 10, 51: '69.74', 52: '111.53', 53: '60', 54: '0', 55: '60',
    56: 'DE', 57: 'PL', 58: '162.70', 59: '51.17', 60: '-3.25',
  });
  assert.equal(e.processDachser(ws, R, cols), 'Mautdifferenz // Sonderfahrt');

  /* Why 110 and not 120: 162.70 - 120 leaves 42.70, short of every NEW PL1
     lane by about 10 EUR. The card values are pinned too, so a regenerated
     card cannot silently make 120 fit. */
  const bracket = e.DACHSER_RATECARDS.new.brackets.find(b => b.von <= 60 && b.bis >= 60);
  assert.ok(bracket, 'the NEW card has a bracket covering 60 kg');
  const lanes = ['PL1 Polen', 'PL2 Polen', 'PL3 Polen'].map(k => bracket.lanes[k]);
  assert.deepEqual(lanes, [52.71, 54.33, 55.97]);
  assert.ok(!lanes.some(v => Math.abs(v - (162.70 - 120)) <= 0.5),
    '120 leaves 42.70, which must not match a NEW PL1 lane');
  assert.ok(lanes.some(v => Math.abs(v - (162.70 - 110)) <= 0.5),
    '110 leaves 52.70, which matches NEW PL1 52.71');
});

test('processDachser: without the ratecards the FR note falls back, it does not guess', () => {
  /* The bundles ship encrypted, so a locked page has no DACHSER_RATECARDS. The
     branch must then keep the previous wording rather than emitting Sonderfahrt
     from a nil lookup. */
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, abg_land: 55,
                 empf_land: 56, fr_dl: 57, fr_tar: 58 };
  const cells = { 50: 10, 51: '98.91', 52: '155.52', 53: '639', 54: '639',
                  55: 'DE', 56: 'PL', 57: '340.9', 58: '185.38' };
  const saved = e.DACHSER_RATECARDS;
  try {
    e.setDachserRatecards(null);
    /* 20260923 row 296 is a real Sonderfahrt, but with no card it must not be
       asserted as one. */
    assert.equal(
      e.processDachser(makeRow(R, cells), R, cols),
      'Dachser berechnet die Kosten nach dem bisherigen Tarif');
  } finally {
    e.setDachserRatecards(saved);
  }
});

test('processDachser: K1AU Sonderfahrt from the rate cards beats bundling and doppelt90', {
  skip: e.DACHSER_RATECARDS ? false : 'needs the local plaintext Dachser ratecard',
}, () => {
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, abg_land: 55,
                 empf_land: 56, serv_art: 57, fr_dl: 58, fr_tar: 59 };
  let ws = makeRow(R, { 3: '1', 50: 10, 51: '98.91', 52: '89.99', 53: '16', 54: '16',
    55: 'DE', 56: 'PL', 57: 'K1AU', 58: '130.7', 59: '40.71' });
  assert.equal(e.processDachser(ws, R, cols), 'Sonderfahrt');
  ws = makeRow(R, { 3: '3', 50: 10, 51: '98.91', 52: '90.05', 53: '191', 54: '191',
    55: 'DE', 56: 'PL', 57: 'K1AU', 58: '161', 59: '70.95' });
  assert.equal(e.processDachser(ws, R, cols), 'Sonderfahrt');
  ws = makeRow(R, { 3: '2', 50: 10, 51: '98.91', 52: '90.03', 53: '5', 54: '5',
    55: 'DE', 56: 'PL', 57: 'K1AU', 58: '132', 59: '41.97' });
  assert.equal(e.processDachser(ws, R, cols), 'Sonderfahrt');
});

test('processDachser: without the ratecards a K1AU |FR-90| row keeps the doppelt90 fallback', () => {
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54, abg_land: 55,
                 empf_land: 56, serv_art: 57, fr_dl: 58, fr_tar: 59 };
  const saved = e.DACHSER_RATECARDS;
  try {
    e.setDachserRatecards(null);
    const ws = makeRow(R, { 3: '1', 50: 10, 51: '98.91', 52: '89.99', 53: '16', 54: '16',
      55: 'DE', 56: 'PL', 57: 'K1AU', 58: '130.7', 59: '40.71' });
    assert.equal(e.processDachser(ws, R, cols), '"Sonderfahrt" 90 EUR doppelt berechnet?');
  } finally {
    e.setDachserRatecards(saved);
  }
});

/* ── Dachser Referenz count: domestic card + PLZ zone table ───────────────────
   The auditor's "Referenz wird Nx abgerechnet" counts the whole national-card
   zone prices that make up FR Kosten DL itself: 20261019 row 429 reads 5x
   because five zone 2 prices reach its 190.50. The arm is terminal, so the note
   stands alone and fires only when no earlier FR branch owns the row.

   Three gates carry the rule and all are pinned below: the tariff copy must be
   the card price of the row's own weight bracket (20261013 row 351 decomposes
   but fails here), the decomposition must be unique at the smallest count
   (ambiguity is silence, not a guess), and FR Kosten DL must not itself be one
   zone price (20260923 row 126: one shipment at its own weight, not a
   duplicate). Three truth-labelled rows stay out of
   reach because they are not domestic: 20260904 row 6, 20261013 rows 29 and
   275.

   The synthetic card gives the gates room: zone 1 prices 10/15/20 across the
   three brackets, zone 2 30/40/15, zone 3 10/10/10 (one distinct price, so a
   two-copy reading can never be unique). */
const REF_COLS = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54,
  abg_land: 55, empf_land: 56, empf_plz: 57, fr_dl: 58, fr_tar: 59, maut: 60,
  referenz3: 61, anz_sdg: 62, serv_art: 63, exp: 64, exp_dl: 65 };
const REF_CARD = {
  schema: 'dachser-ratecards/v1',
  national: {
    schema: 'dachser-national-ratecard/v1',
    source: 'synthetic',
    plz_source: 'synthetic',
    capped_at_bis: 150,
    brackets: [
      { bis: 50, zones: { 1: 10, 2: 30, 3: 10 } },
      { bis: 100, zones: { 1: 15, 2: 40, 3: 10 } },
      { bis: 150, zones: { 1: 20, 2: 15, 3: 10 } },
    ],
    plz: { '01': '1', '02': '2', '03': '3' },
  },
};
function refRow(cells) {
  return makeRow(R, Object.assign(
    { 50: 10, 51: '98.91', 52: '15', 53: '40', 54: '40', 55: 'DE', 56: 'DE',
      57: '01067', 58: '25', 59: '10' }, cells));
}
function withRefCard(fn) {
  const saved = e.DACHSER_RATECARDS;
  try {
    e.setDachserRatecards(REF_CARD);
    return fn();
  } finally {
    e.setDachserRatecards(saved);
  }
}

test('processDachser: the Referenz note stands alone when it fires', () => {
  /* Mautdifferenz and Produktzuschlag are decided before the FR chain, and the
     20261019 cells carry both segments beside the count. The finding is
     terminal: the row answers with the Referenz phrase only. */
  withRefCard(() => {
    const ws = refRow({ 60: '2.5', 64: '5', 65: '10' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Referenz wird 2x abgerechnet');
  });
});

test('processDachser: the sum need not include the row\'s own bracket cell', () => {
  /* 120 kg is the <=150 kg bracket, so the tariff copy is 20.00 while the two
     whole copies are 10.00 + 15.00. Counting the delta instead would read 5.00
     and find nothing (20261019 row 336). */
  withRefCard(() => {
    const ws = refRow({ 52: '5', 53: '120', 54: '120', 58: '25', 59: '20' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Referenz wird 2x abgerechnet');
  });
});

test('processDachser: three whole copies read as 3x', () => {
  /* 55 = 15 + 20 + 20, the only three-price decomposition of zone 1. */
  withRefCard(() => {
    const ws = refRow({ 52: '45', 58: '55' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Referenz wird 3x abgerechnet');
  });
});

test('processDachser: an ambiguous decomposition stays silent', () => {
  /* 30 is both 10 + 20 and 15 + 15: two decompositions at the smallest count of
     2, so the decomposition is not unique and the row keeps the weight wording
     instead of picking one. */
  withRefCard(() => {
    const ws = refRow({ 52: '20', 58: '30' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Frachtdifferenz');
  });
});

test('processDachser: five whole copies read as 5x, six stay silent', () => {
  /* 95 = 15 + 20 + 20 + 20 + 20 is the only five-copy reading (20261019 row
     429), and 120 = 6 x 20 the only six-copy one, so a cap of 6 reads 6x. */
  withRefCard(() => {
    assert.equal(e.processDachser(refRow({ 52: '85', 58: '95' }), R, REF_COLS),
      'Referenz wird 5x abgerechnet');
    assert.equal(e.processDachser(refRow({ 52: '95', 58: '120' }), R, REF_COLS),
      'Frachtdifferenz');
  });
});

test('processDachser: a PLZ prefix missing from the zone table stays silent', () => {
  withRefCard(() => {
    const ws = refRow({ 52: '30', 57: '99999', 58: '40' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Frachtdifferenz');
  });
});

test('processDachser: a non-domestic lane never carries the Referenz note', () => {
  /* 20261019 row 201 (DE->PL) is the Sonderfahrt 110 witness; its tariff copy
     is a lane price, not a zone price, so the domestic count must not fire. */
  withRefCard(() => {
    const ws = refRow({ 52: '111.53', 56: 'PL', 57: '35-025', 58: '162.7', 59: '51.17' });
    assert.equal(e.processDachser(ws, R, REF_COLS),
      'Dachser berechnet die Kosten nach dem bisherigen Tarif');
  });
});

test('processDachser: a tariff copy off the ladder stays silent', () => {
  /* The 25.00 sum would decompose, but 10.50 is not a zone 1 ladder cell. */
  withRefCard(() => {
    const ws = refRow({ 52: '24.9', 58: '35.4', 59: '10.5' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Frachtdifferenz');
  });
});

test('processDachser: the Referenz arm never steals a flagged row', () => {
  /* Each of these rows would pass the count gate, but the earlier branch owns
     the note: multi-consignment, the ZW intermediate consignee, and K1AS. */
  withRefCard(() => {
    assert.equal(e.processDachser(refRow({ 62: '2' }), R, REF_COLS),
      'hätte gebündelt werden können?');
    assert.equal(e.processDachser(refRow({ 61: 'ZW' }), R, REF_COLS),
      'Differenz aufgrund abweichender Zwischenempfänger 01067');
    assert.equal(e.processDachser(refRow({ 63: 'K1AS' }), R, REF_COLS),
      'Sonderfahrt');
  });
});

test('processDachser: a weight above the card\'s last bracket stays silent', () => {
  /* Brutto kg 200 has no ladder row (the synthetic card ends at 150), so there
     is no cell to compare the tariff copy against and the arm stays off. */
  withRefCard(() => {
    const ws = refRow({ 53: '200', 54: '200', 58: '35', 59: '20' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Frachtdifferenz');
  });
});

test('processDachser: a freight below the tariff copy stays silent', () => {
  /* fr_dl 5 under fr_tar 15 is a credit, not a second billed copy: the count
     stays off and the row keeps its weight wording. */
  withRefCard(() => {
    const ws = refRow({ 52: '-10', 53: '100', 54: '100', 58: '5', 59: '15' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Differenz aufgrund abweichender Gewichte');
  });
});

test('processDachser: a copy is accepted at exactly 0.08 off, not at 0.09', () => {
  /* 20261019 row 458 needs the whole 0.08; 0.11 would change row 474's count. */
  withRefCard(() => {
    assert.equal(e.processDachser(refRow({ 52: '15.08', 58: '25.08' }), R, REF_COLS),
      'Referenz wird 2x abgerechnet');
    assert.equal(e.processDachser(refRow({ 52: '15.09', 58: '25.09' }), R, REF_COLS),
      'Frachtdifferenz');
  });
});

test('processDachser: without the national card the Referenz note stays off', () => {
  /* A locked page has no DACHSER_RATECARDS, and an older bundle has no
     `national` key at all. Both must fall back to the weight wording. */
  const saved = e.DACHSER_RATECARDS;
  try {
    e.setDachserRatecards(null);
    assert.equal(e.processDachser(refRow({}), R, REF_COLS), 'Frachtdifferenz');
    e.setDachserRatecards({ schema: 'dachser-ratecards/v1', new: { brackets: [] }, old: { brackets: [] } });
    assert.equal(e.processDachser(refRow({}), R, REF_COLS), 'Frachtdifferenz');
  } finally {
    e.setDachserRatecards(saved);
  }
});

test('processDachser: the Referenz table matches the confirmed sheet rows', {
  skip: e.DACHSER_RATECARDS ? false : 'needs the local plaintext Dachser ratecard',
}, () => {
  /* 17 rows: the 13 the rule must label (20261019 336/363/373/399/429/458/466/
     467/474/478, 20261013 161/174, 20260903 303) and the 4 that fence it:
     351 and 20260903 250/270 fail the tariff-copy gate, 201 is not domestic.
     Each labelled row must answer with the Referenz phrase alone. */
  const rows = JSON.parse(
    readFileSync(new URL('./fixtures/dachser-referenz-rows.json', import.meta.url), 'utf8'));
  const mismatches = [];
  for (const x of rows) {
    const ws = makeRow(R, { 50: 10, 51: '98.91', 52: String(x.fr_dl - x.fr_tar),
      53: String(x.kg), 54: String(x.kg), 55: x.abg, 56: x.empf, 57: x.plz,
      58: String(x.fr_dl), 59: String(x.fr_tar) });
    const out = String(e.processDachser(ws, R, REF_COLS) || '');
    const want = x.want === 'none' ? undefined : 'Referenz wird ' + x.want.slice(1) + 'x abgerechnet';
    const ok = want === undefined
      ? !/Referenz wird \d+x abgerechnet/.test(out)
      : out === want;
    if (!ok) {
      mismatches.push(`${x.tag} r${x.row} plz${x.plz} kg${x.kg} DL=${x.fr_dl} TAR=${x.fr_tar} want=${want || x.want} got=${out || 'none'} (${x.why})`);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('\n'));
});

test('processDachser: a FR Kosten DL that is one zone price is not a duplicate', {
  skip: e.DACHSER_RATECARDS ? false : 'needs the local plaintext Dachser ratecard',
}, () => {
  /* 20260923 row 126, cell for cell: zone 4 through PLZ 80839, Brutto 483 kg,
     FR Kosten DL 216.90 and FR Kosten lt. Tarif 105.98 (the row's <=500 kg cell).
     The freight is the <=1200 kg cell 216.93 within 0.03, so Dachser billed one
     shipment at its own weight; the sum gate alone would read 3x from 31.60 +
     49.82 + 135.53 = 216.95, 0.05 inside its bound. The sheet says Mautdifferenz
     // abweichender Gewichte, and the cascade has to keep reaching it. */
  const ws = makeRow(R, { 50: 10, 51: '126.6', 52: '110.92', 53: '483',
    54: '1185', 55: 'DE', 56: 'DE', 57: '80839', 58: '216.9', 59: '105.98',
    60: '12.22', 62: '1', 63: 'DA01' });
  const out = String(e.processDachser(ws, R, REF_COLS) || '');
  assert.equal(out, 'Mautdifferenz // Differenz aufgrund abweichender Gewichte');
  assert.ok(!/Referenz wird \d+x abgerechnet/.test(out), out);
});

test('processDachser: the ladder guard silences a FR Kosten DL equal to one copy', () => {
  /* FR DL 20.00 is the zone 1 <=150 kg cell and 20 = 10 + 10 is a unique two-copy
     reading, so only the ladder guard keeps this row on its freight wording. */
  withRefCard(() => {
    const ws = refRow({ 52: '10', 58: '20', 59: '10' });
    assert.equal(e.processDachser(ws, R, REF_COLS), 'Frachtdifferenz');
  });
});

test('dachser ratecard asset: the national card is nine zones, capped and sound', {
  skip: e.DACHSER_RATECARDS ? false : 'needs the local plaintext Dachser ratecard',
}, () => {
  /* Guards the builder: a corrupt upper bracket or a lost zero-padded prefix
     would otherwise surface as a wrong price instead of a missing one. */
  const nat = e.DACHSER_RATECARDS.national;
  for (const b of nat.brackets) {
    assert.deepEqual(Object.keys(b.zones).sort(), ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      `bracket <=${b.bis} kg must carry all nine zones`);
    for (const z of Object.keys(b.zones)) {
      assert.ok(b.zones[z] < 1000, `zone ${z} at <=${b.bis} kg is ${b.zones[z]}, the workbook lost its decimal separator`);
    }
  }
  /* The supplied workbook loses its decimal separator above capped_at_bis; every
     bracket from recovered_from_bis on was repaired and must still climb. */
  assert.ok(nat.recovered_from_bis > nat.capped_at_bis,
    'the recovered band starts after the last source-sound bracket');
  assert.equal(nat.withheld_from_bis, null, 'the repaired band is kept, nothing is withheld');
  let prev = null;
  for (const b of nat.brackets) {
    if (prev) {
      for (const z of Object.keys(b.zones)) {
        assert.ok(b.zones[z] >= prev[z],
          `zone ${z} drops from ${prev[z]} to ${b.zones[z]} at <=${b.bis} kg`);
      }
    }
    prev = b.zones;
  }
  for (const k of Object.keys(nat.plz)) {
    assert.match(k, /^\d{2}$/, `PLZ prefix ${k} must be zero-padded to two digits`);
    assert.match(nat.plz[k], /^[1-9]$/, `prefix ${k} must map to a zone digit`);
  }
});

test('phraseToKey: a counted Referenz phrase resolves to the template', () => {
  assert.equal(e.phraseToKey('Referenz wird 2x abgerechnet'), 'tpl_referenzNx');
  assert.equal(e.phraseToKey('Referenz wird 3x abgerechnet'), 'tpl_referenzNx');
  assert.equal(e.phraseToKey('Referenz wird x abgerechnet'), null);
});

test('collectInputsForRow: dachser exports the FR pair without re-keying the row', () => {
  /* A bundle-trained model needs FR_DL / FR_Tar to replay the Referenz gate,
     but both are excluded from the uid seed so every historical uid survives. */
  const cols = { stat: 50, tarif: 51, fr: 52, brutto: 53, vkg_dl: 54,
    empf_plz: 57, fr_dl: 58, fr_tar: 59 };
  const ws = makeRow(R, { 50: 10, 51: '98.91', 52: '40', 53: '40', 54: '40',
    57: '01067', 58: '40', 59: '10' });
  const inputs = e.collectInputsForRow('dachser', ws, R, cols);
  assert.equal(inputs.fr_dl, '40');
  assert.equal(inputs.fr_tar, '10');
  const before = Object.assign({}, inputs);
  delete before.fr_dl;
  delete before.fr_tar;
  const withPair = e.rowUid('dachser', 'sheet', R, inputs);
  assert.equal(withPair, e.rowUid('dachser', 'sheet', R, before));
  /* Wackler already exports these keys, so they must not be excluded globally. */
  assert.notEqual(e.rowUid('wackler', 'sheet', R, { fr_dl: '40', fr_tar: '10' }),
    e.rowUid('wackler', 'sheet', R, {}));
});
