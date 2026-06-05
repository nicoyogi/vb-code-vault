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

test('processWackler: existing annotation is ignored — output recomputed from inputs', () => {
  // target cell already holds a phrase, but the engine never preserves it:
  // VKG=120 and VKG_DL=130 both fall in the 150 kg bucket -> same-tier wording,
  // proving the pre-existing "Differenz aufgrund abweichender Gewichte" is discarded.
  const ws = makeRow(R, {
    50: 'Differenz aufgrund abweichender Gewichte',
    51: 10, 52: '100', 55: '5', 59: '120', 60: '130', 63: '1', 64: '2',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Wackler rechnet Frachtrate für 150kg ab');
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

test('processWackler: cross-tier weights + FR -> Differenz aufgrund abweichender Gewichte', () => {
  // VKG=120 (tier 150) vs VKG_DL=400 (tier 400) fall in different rate buckets
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '5', 59: '120', 60: '400', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz aufgrund abweichender Gewichte');
});

test('processWackler: bare FR delta -> Frachtdifferenz', () => {
  const ws = makeRow(R, { 51: 10, 52: '100', 55: '5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Frachtdifferenz');
});

test('processWackler: blank KOST/SACH only -> Kontierung?', () => {
  const ws = makeRow(R, { 51: 10, 52: '100' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Kontierung?');
});

test('processWackler: TZ >= 2.0 alone -> Differenz Energiezuschlag', () => {
  const ws = makeRow(R, { 51: 10, 52: '100', 57: '5', 63: '1', 64: '2' });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Differenz Energiezuschlag');
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
  // Bundling wins over the "Wackler rechnet" wording, and MT/TZ stay additive.
  const ws = makeRow(R, {
    51: 10, 52: '100', 55: '5', 56: '3', 57: '5',
    58: '111,222', 59: '120', 60: '130', 63: '1', 64: '2',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'hätte gebündelt werden müssen // Mautdifferenz // Differenz Energiezuschlag'
  );
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

test('processWackler: blank tariff + code-less SNK still falls through to Lagergeld', () => {
  // Guard: the new SNK-code escape must not break the Lagergeld catch-all for un-tariffed,
  // code-less SNK gaps (SNK=60 matches no code).
  const ws = makeRow(R, {
    51: 10, 54: '60', 59: '500', 60: '500',
    61: '12345', 62: 'Musterstadt', 63: '211FO998', 64: '612100',
  });
  assert.equal(e.processWackler(ws, R, W_COLS), 'Lagergeld');
});

test('processWackler: same-tier multi-ref with near-equal weights -> Wackler rechnet (MT additive)', () => {
  // Bundle row f04300d4: 2 refs, VKG 6840 / VKG_DL 6862 (~0.3% apart) share the 7000 kg tier.
  // Near-equal weights read as one shared tier rate, not a "should have been bundled" finding;
  // the negative FR credit absorbs the fuel note, and Maut stays additive.
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

test('processWackler: same-tier multi-ref with UNEQUAL weights stays "hätte gebündelt werden müssen"', () => {
  // Guard for the near-equal band: 120 vs 130 kg (~8% apart) share the 150 kg tier but are
  // materially different weights -> genuine bundling, MT/TZ additive.
  const ws = makeRow(R, {
    51: 10, 52: '100', 55: '5', 56: '3', 57: '5',
    58: '111,222', 59: '120', 60: '130', 63: '1', 64: '2',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'hätte gebündelt werden müssen // Mautdifferenz // Differenz Energiezuschlag'
  );
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
