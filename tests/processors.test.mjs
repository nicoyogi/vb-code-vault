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

test('processDachser: blank TARIF + FR with SERV/SACH -> Fremdnummer already-billed note', () => {
  const cols = { stat: 50, tarif: 51, fr: 52 };
  // SERV_ART=16, SACHKONTO=35 populated => the "already billed in another Beleg" branch.
  // The document numbers are a placeholder template (5034xxx / RE00123xxx): the real
  // Fremdnummer + the Beleg it was already charged in are cross-document and not
  // derivable from a single row's inputs (bundle 2026-06-29 rows 76aca1f8 / 33def378).
  const ws = makeRow(R, { 50: 10, 52: '47.2', 16: 'DA01', 35: '612100' });
  assert.equal(e.processDachser(ws, R, cols), 'Fremdnummer 5034xxx bereits berechnet in RE00123xxx, ok?');
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
  kostenstelle: 63, sachkonto: 64, zone: 65, empf_land: 66, abg_land: 67, abg_plz: 68,
  fr_tar: 69, fr_dl: 70,
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
    51: 10, 52: '32.46', 55: '-2.96',
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
    51: 10, 52: '32.46', 55: '-2.96',
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
    51: 10, 52: '500', 55: '30',
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

test('processWackler: LIGHT equal-weight multi-ref bundle -> hätte gebündelt werden müssen', () => {
  // Bundle row cf56daaa: 2 refs, VKG=VKG_DL=231 (250 kg tier), DE5, FR=+15.39, AVIS=8.7.
  // Light consignments (combined <= 1000 kg) should have ridden one booking — bundling wins
  // over the rate-card wording. MT/TZ stay additive, AVIS resolves to "Avis, ok?".
  const ws = makeRow(R, {
    51: 10, 52: '78.9', 53: '8.7', 54: '0.07', 55: '15.39', 56: '1.25', 57: '2.01',
    58: '2543320386,2543320633', 59: '231', 60: '231',
    61: '95100', 62: 'Selb', 63: '211FO998', 64: '612100',
    66: 'DE', 67: 'DE',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Avis, ok? // hätte gebündelt werden müssen // Mautdifferenz // Differenz Energiezuschlag'
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
  // one, so the booking should have been bundled. AVIS=8.7 -> "Avis, ok?"; MT/TZ additive.
  const ws = makeRow(R, {
    51: 10, 52: '554.22', 53: '8.7', 54: '0.27', 55: '65.6', 56: '4.16', 57: '8.53',
    58: '2543276386,2543320440', 59: '5465,44', 60: '6158',
    61: '76829', 62: 'Landau in der Pfalz', 63: '211FO011', 64: '612100',
  });
  assert.equal(
    e.processWackler(ws, R, W_COLS),
    'Avis, ok? // hätte gebündelt werden müssen // Mautdifferenz // Differenz Energiezuschlag'
  );
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
