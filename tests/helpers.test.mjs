/*
 * Unit tests for the pure helper functions of the Anmerkung rule engine.
 * These are deterministic, side-effect-free functions: weight-tier lookups,
 * surcharge/AVIS code books, string joining/normalisation, column-letter math,
 * and the phrase -> stable-key reverse index.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness/load-engine.mjs';

const e = loadEngine();

/* Engine array results are created inside the vm realm (different Array.prototype),
   so deepStrictEqual would reject them on prototype identity alone. Re-wrap into a
   host array before comparing structure. */
const A = (x) => Array.from(x);

test('dachserGetTier: rate-card bucket lookup', () => {
  assert.equal(e.dachserGetTier(0), 0, '<=0 kg has no tier');
  assert.equal(e.dachserGetTier(-5), 0);
  assert.equal(e.dachserGetTier(50), 50, 'exact lower bound stays in its bucket');
  assert.equal(e.dachserGetTier(51), 100, 'just over rolls to next bucket');
  assert.equal(e.dachserGetTier(10000), 10000, 'rate-card ceiling');
  assert.equal(e.dachserGetTier(10001), 999999, 'above ceiling -> open bucket');
  assert.equal(e.dachserGetTier(1e6), 999999);
});

test('knGetTier: collapsed 8500/9500 band + open 99999 ceiling', () => {
  assert.equal(e.knGetTier(0), 0);
  assert.equal(e.knGetTier(8000), 8500, 'K+N collapses 8000 into the 8500 bucket');
  assert.equal(e.knGetTier(8500), 8500);
  assert.equal(e.knGetTier(9000), 9500);
  assert.equal(e.knGetTier(100000), 99999, 'K+N tops out at an open 99999');
});

test('wacklerGetTier / wacklerTierLabel', () => {
  assert.equal(e.wacklerGetTier(0), 0);
  assert.equal(e.wacklerGetTier(8000), 8000, 'Wackler keeps every 500kg step in the heavy band');
  assert.equal(e.wacklerGetTier(10000), 10000);
  assert.equal(e.wacklerGetTier(10001), 999999);
  assert.equal(e.wacklerTierLabel(150), '150');
  assert.equal(e.wacklerTierLabel(999999), '>10000', 'open ceiling renders as ">10000"');
});

test('wacklerGetTierIdx: adjacency used by the bundling cut', () => {
  assert.equal(e.wacklerGetTierIdx(0), -1, '<=0 kg has no index');
  assert.equal(e.wacklerGetTierIdx(50), 0);
  assert.equal(e.wacklerGetTierIdx(51), 1);
  assert.equal(e.wacklerGetTierIdx(100), 1);
  // adjacent buckets differ by exactly one index
  assert.equal(e.wacklerGetTierIdx(100) - e.wacklerGetTierIdx(50), 1);
});

test('daIsNonInteger: cents-bearing tariff detection', () => {
  assert.equal(e.daIsNonInteger(14.72), true);
  assert.equal(e.daIsNonInteger(7.57), true);
  assert.equal(e.daIsNonInteger(14), false);
  assert.equal(e.daIsNonInteger(0), false);
  assert.equal(e.daIsNonInteger(-5), false);
});

test('daDetectSurchargeFromDiff: recover surcharge code from a cents tariff', () => {
  // non-integer SNK_DL whose SNK_DIFF rounds cleanly to a known code (5/9/11/14)
  assert.equal(e.daDetectSurchargeFromDiff(14.72, 9.01), 9);
  assert.equal(e.daDetectSurchargeFromDiff(14.72, 5.01), 5);
  assert.equal(e.daDetectSurchargeFromDiff(7.57, 11.0), 11);
  // integer SNK_DL -> no re-derivation
  assert.equal(e.daDetectSurchargeFromDiff(14, 9.01), 0);
  // rounds to a non-code value
  assert.equal(e.daDetectSurchargeFromDiff(14.72, 7.0), 0);
  // too far from the rounded code (> 0.05 window)
  assert.equal(e.daDetectSurchargeFromDiff(14.72, 9.2), 0);
});

test('wacklerSnkCode: sign-insensitive code book with tolerance', () => {
  assert.equal(e.wacklerSnkCode(38), 'NL-FIX');
  assert.equal(e.wacklerSnkCode(-38.08), 'NL-FIX', 'reversible code seen as a credit, within tolerance');
  assert.equal(e.wacklerSnkCode(11.5), 'hätte B2C-Line abrechnen dürfen');
  assert.equal(e.wacklerSnkCode(22), '2. Zustellung ok?');
  assert.equal(e.wacklerSnkCode(180), 'Terminzustellung, ok?');
  assert.equal(e.wacklerSnkCode(100), null, 'unknown value -> no code');
});

test('isWacklerAvisCode / wacklerAvisLabel', () => {
  assert.equal(e.isWacklerAvisCode(7.5), true);
  assert.equal(e.isWacklerAvisCode(-8.7), true);
  assert.equal(e.isWacklerAvisCode(5), false);
  assert.equal(e.wacklerAvisLabel(7.5), 'Avis, ok?');
  assert.equal(e.wacklerAvisLabel(8.7), 'Avis, ok?', 'positive 8.7 is still the generic AVIS code');
  assert.equal(
    e.wacklerAvisLabel(-8.7),
    'hätte Avisgebühr telefonisch abrechnen dürfen',
    'negative 8.7 credit is the "should have billed telephonically" signature',
  );
  assert.equal(e.wacklerAvisLabel(5), null);
});

test('hasErr: symmetric threshold', () => {
  assert.equal(e.hasErr(0.1, 0.08), true);
  assert.equal(e.hasErr(-0.2, 0.08), true);
  assert.equal(e.hasErr(0.05, 0.08), false);
  assert.equal(e.hasErr(0.08, 0.08), false, 'strictly greater-than, not >=');
});

test('join: case-insensitive de-duplicating concatenation', () => {
  assert.equal(e.join('a', ''), 'a');
  assert.equal(e.join('', 'b'), 'b');
  assert.equal(e.join('a', 'b'), 'a // b');
  assert.equal(e.join('Foo', 'foo'), 'Foo', 'already present (case-folded) -> unchanged');
  assert.equal(e.join('a // b', 'a'), 'a // b', 'substring already present -> unchanged');
});

test('splitTriggers / normPhrase / samePhraseSet', () => {
  assert.deepEqual(A(e.splitTriggers('a // b // c')), ['a', 'b', 'c']);
  assert.deepEqual(A(e.splitTriggers('')), []);
  assert.deepEqual(A(e.splitTriggers('  x  ')), ['x']);

  assert.equal(e.normPhrase('  Foo   Bar '), 'foo bar');
  assert.equal(e.normPhrase(null), '');

  assert.equal(e.samePhraseSet(['A', 'b'], ['B', 'a']), true, 'order- and case-insensitive');
  assert.equal(e.samePhraseSet(['a'], ['a', 'b']), false);
});

test('idxToCol / colToIdx: spreadsheet column-letter math round-trips', () => {
  assert.equal(e.idxToCol(0), 'A');
  assert.equal(e.idxToCol(25), 'Z');
  assert.equal(e.idxToCol(26), 'AA');
  assert.equal(e.colToIdx('A'), 0);
  assert.equal(e.colToIdx('Z'), 25);
  assert.equal(e.colToIdx('AA'), 26);
  for (const i of [0, 1, 25, 26, 27, 51, 52, 700]) {
    assert.equal(e.colToIdx(e.idxToCol(i)), i, `round-trip at ${i}`);
  }
});

test('phraseToKey: catalog / literal / template resolution', () => {
  // 1. exact catalog hit
  assert.equal(e.phraseToKey('AUSFALLFRACHT'), 'ausfallfracht');
  assert.equal(e.phraseToKey('  standgeld  '), 'standgeld', 'trimmed + case-folded');
  // 2. direct literal (not yet promoted into PHRASES)
  assert.equal(e.phraseToKey('Differenz Hebebuehnen-Zuschlag'), 'lit_differenzHebebuehnen');
  // 3. template family (interpolated runtime values)
  assert.equal(
    e.phraseToKey('Differenz aufgrund abweichender Zwischenempfänger 12345 Berlin'),
    'zwPrefix',
  );
  // unmapped
  assert.equal(e.phraseToKey('totally unknown phrase'), null);
  assert.equal(e.phraseToKey(''), null);
  assert.equal(e.phraseToKey(null), null);
});

test('phraseKeysFor: array mapping with ?: sentinel for misses', () => {
  assert.deepEqual(A(e.phraseKeysFor(['AUSFALLFRACHT', 'Standgeld'])), ['ausfallfracht', 'standgeld']);
  assert.deepEqual(A(e.phraseKeysFor(['AUSFALLFRACHT', 'nope'])), ['ausfallfracht', '?:nope']);
  assert.deepEqual(A(e.phraseKeysFor([])), []);
});
