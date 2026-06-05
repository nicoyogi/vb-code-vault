/*
 * Unit tests for Diff Mode's training-output primitives.
 *
 * These are the pure functions that decide how every exported training row is
 * labeled and decomposed:
 *   - classifyDiff      — top-level wrong/missed/overfired/correct (phrase-set based)
 *   - computePhraseDiff — common/missing/extra phrase buckets + Jaccard
 *   - granularLabel     — the fine-grained sub-label
 *   - rowUid            — stable cross-run row hash
 *
 * The engine-vs-truth fields added in #26 (engine_label, engine_matches_b,
 * engine_missing_phrases, engine_extra_phrases, …) are produced inside
 * diffWorkbooks by calling classifyDiff / computePhraseDiff / granularLabel
 * with the CURRENT engine output on the predicted side instead of slot A.
 * diffWorkbooks itself is DOM/XLSX-bound and not unit-testable in isolation,
 * so the final block here pins the exact composition those fields rely on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness/load-engine.mjs';

const e = loadEngine();

/* Engine arrays come from the vm realm (foreign Array.prototype); re-wrap into
   a host array before structural comparison. */
const A = (x) => Array.from(x);

/* ── classifyDiff — phrase-SET equality, not raw-string ── */

test('classifyDiff: identical content is correct', () => {
  assert.equal(e.classifyDiff('Kontierung?', 'Kontierung?'), 'correct');
  assert.equal(e.classifyDiff('', ''), 'correct', 'two empties are an empty-set match');
});

test('classifyDiff: order / case / whitespace differences are still correct', () => {
  assert.equal(e.classifyDiff('a // b', 'b // a'), 'correct', 'phrase order is irrelevant');
  assert.equal(e.classifyDiff('Foo', 'foo'), 'correct', 'case folded like the engine dedup');
  assert.equal(e.classifyDiff('a  //  b', 'a // b'), 'correct', 'separator whitespace ignored');
});

test('classifyDiff: missed / overfired / wrong', () => {
  assert.equal(e.classifyDiff('', 'Differenz treibstoff'), 'missed', 'A empty, B filled');
  assert.equal(e.classifyDiff('Differenz treibstoff', ''), 'overfired', 'A filled, B empty');
  assert.equal(e.classifyDiff('a // b', 'a // c'), 'wrong', 'both filled, sets differ');
});

/* ── computePhraseDiff — bucketed phrase diff + Jaccard ── */

test('computePhraseDiff: missing phrase, common phrase, half Jaccard', () => {
  const pd = e.computePhraseDiff(
    'Portalavisierung, ok?',
    'Portalavisierung, ok? // Differenz treibstoff'
  );
  assert.deepStrictEqual(A(pd.common_phrases), ['Portalavisierung, ok?']);
  assert.deepStrictEqual(A(pd.missing_phrases), ['Differenz treibstoff'], 'in B not A → missing');
  assert.deepStrictEqual(A(pd.extra_phrases), []);
  assert.equal(pd.phrase_jaccard, 0.5, '1 common / 2 union');
});

test('computePhraseDiff: extra phrase (A over-fired vs B)', () => {
  const pd = e.computePhraseDiff('a // b', 'a');
  assert.deepStrictEqual(A(pd.extra_phrases), ['b'], 'in A not B → extra');
  assert.deepStrictEqual(A(pd.missing_phrases), []);
  assert.equal(pd.phrase_jaccard, 0.5);
});

test('computePhraseDiff: duplicate phrases are deduped per side', () => {
  const pd = e.computePhraseDiff('Maut // maut', 'Maut // Energie');
  assert.deepStrictEqual(A(pd.common_phrases), ['Maut'], 'duplicate "maut" collapses to one common');
  assert.deepStrictEqual(A(pd.missing_phrases), ['Energie']);
  assert.deepStrictEqual(A(pd.extra_phrases), []);
  assert.equal(pd.phrase_jaccard, 0.5, 'dedup keeps Jaccard <= 1');
});

test('computePhraseDiff: two empties are a perfect match (jaccard 1)', () => {
  const pd = e.computePhraseDiff('', '');
  assert.equal(pd.phrase_jaccard, 1, 'empty union is defined as identical');
  assert.deepStrictEqual(A(pd.missing_phrases), []);
  assert.deepStrictEqual(A(pd.extra_phrases), []);
});

/* ── granularLabel — fine-grained sub-label ── */

test('granularLabel: string-level matches', () => {
  const g = (a, b) => e.granularLabel(a, b, e.computePhraseDiff(a, b));
  assert.equal(g('abc', 'abc'), 'exact_match');
  assert.equal(g('', ''), 'empty_match');
  assert.equal(g('ABC', 'abc'), 'case_only');
  assert.equal(g('a  b', 'a b'), 'whitespace');
  assert.equal(g('a // b', 'b // a'), 'reordered', 'same set, different order is a match');
});

test('granularLabel: set-relation sub-labels', () => {
  const g = (a, b) => e.granularLabel(a, b, e.computePhraseDiff(a, b));
  assert.equal(g('a', 'a // b'), 'phrase_subset', 'engine UNDER-fired (A ⊂ B)');
  assert.equal(g('a // b', 'a'), 'phrase_superset', 'engine OVER-fired (B ⊂ A)');
  assert.equal(g('a // b', 'a // c'), 'phrase_overlap', 'share one, each has a unique');
  assert.equal(g('a', 'b'), 'phrase_disjoint', 'no shared phrase');
  assert.equal(g('', 'x'), 'missed_full');
  assert.equal(g('x', ''), 'overfired_full');
});

/* ── rowUid — stable cross-run hash ── */

test('rowUid: deterministic and input-order independent', () => {
  const u1 = e.rowUid('wackler', 'Sheet1', 5, { a: '1', b: '2' });
  const u2 = e.rowUid('wackler', 'Sheet1', 5, { b: '2', a: '1' });
  assert.equal(u1, u2, 'input key order must not change the hash');
  assert.match(u1, /^[0-9a-f]{8}$/, '8-char hex FNV-1a');
});

test('rowUid: sourceTag namespaces otherwise-identical rows', () => {
  const base = e.rowUid('wackler', 'Sheet1', 5, { a: '1' });
  const p1 = e.rowUid('wackler', 'Sheet1', 5, { a: '1' }, 'pairP1');
  const p2 = e.rowUid('wackler', 'Sheet1', 5, { a: '1' }, 'pairP2');
  assert.notEqual(p1, p2, 'different source tags must not collide in a bulk corpus');
  assert.notEqual(base, p1, 'tagging changes the hash vs the untagged single-pair case');
});

test('rowUid: different content yields a different hash', () => {
  const u1 = e.rowUid('wackler', 'Sheet1', 5, { a: '1' });
  const u2 = e.rowUid('wackler', 'Sheet1', 6, { a: '1' });
  assert.notEqual(u1, u2);
});

/* ── engine-vs-truth (#26) derivation ──
   The engine_* fields run the SAME primitives with the current engine's
   output on the predicted side and ground truth (B) on the expected side.
   These pin that contract so the export's fix-target signal stays correct. */

test('engine-vs-truth: missing = "engine should add", extra = "engine should remove"', () => {
  const engineNow = 'Mautdifferenz // Portalavisierung, ok?';
  const truth = 'Mautdifferenz // Differenz treibstoff';
  assert.equal(e.classifyDiff(engineNow, truth), 'wrong');
  const pd = e.computePhraseDiff(engineNow, truth);
  assert.deepStrictEqual(A(pd.missing_phrases), ['Differenz treibstoff'],
    'truth wants it, engine lacks it → engine_missing_phrases (branch to ADD/loosen)');
  assert.deepStrictEqual(A(pd.extra_phrases), ['Portalavisierung, ok?'],
    'engine emits it, truth rejects it → engine_extra_phrases (branch to GUARD/tighten)');
});

test('engine-vs-truth: tool right (A==B) but engine regressed is still a labeled error', () => {
  const slotA = 'Mautdifferenz // Differenz treibstoff';
  const truth = slotA;                       // tool agreed with truth → label "correct"
  const engineNow = 'Mautdifferenz';         // current engine dropped a phrase
  assert.equal(e.classifyDiff(slotA, truth), 'correct', 'A vs B is correct');
  // …but the engine-vs-truth view flags the regression:
  assert.equal(e.classifyDiff(engineNow, truth), 'wrong', 'engine_label catches the regression');
  const pd = e.computePhraseDiff(engineNow, truth);
  assert.deepStrictEqual(A(pd.missing_phrases), ['Differenz treibstoff']);
  assert.equal(e.granularLabel(engineNow, truth, pd), 'phrase_subset');
});

test('engine-vs-truth: a solved row reports correct + jaccard 1', () => {
  const engineNow = 'Differenz treibstoff // Mautdifferenz';
  const truth = 'Mautdifferenz // Differenz treibstoff';   // reordered → same set
  assert.equal(e.classifyDiff(engineNow, truth), 'correct');
  assert.equal(e.computePhraseDiff(engineNow, truth).phrase_jaccard, 1);
});
