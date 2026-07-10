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
import { loadEngine, makeRow } from './harness/load-engine.mjs';

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

test('rowUid: v1.30 input keys are excluded from the seed — uids stay joinable with historical bundles', () => {
  const legacy = e.rowUid('wackler', 'Sheet1', 5, { stat: '10', empf_plz: '88499' });
  const enriched = e.rowUid('wackler', 'Sheet1', 5, {
    stat: '10', empf_plz: '88499',
    abg_land: 'DE', empf_land: 'FR', abg_plz: '70173', zone: 'FR3',
    c502_dl: '12', c503_dl: '7',
  });
  assert.equal(enriched, legacy,
    'newly-exported lane/zone/storage cells must not re-key rows that exist in pre-v1.30 bundles');
  const changedLegacyKey = e.rowUid('wackler', 'Sheet1', 5, { stat: '10', empf_plz: '88499', vkg: '250' });
  assert.notEqual(changedLegacyKey, legacy, 'v1.29 seed keys still differentiate rows');
});

/* ── collectInputsForRow — the export must carry every cell the engine gates on ── */

test('collectInputsForRow: wackler exports the lane/zone signals, dachser the 502/503 storage cells', () => {
  const wRow = makeRow(4, { 0: '10', 1: 'DE', 2: 'FR', 3: '70173', 4: 'FR3' });
  const wCols = { stat: 0, abg_land: 1, empf_land: 2, abg_plz: 3, zone: 4 };
  const w = e.collectInputsForRow('wackler', wRow, 4, wCols);
  assert.equal(w.abg_land, 'DE');
  assert.equal(w.empf_land, 'FR');
  assert.equal(w.abg_plz, '70173');
  assert.equal(w.zone, 'FR3');
  const dRow = makeRow(4, { 0: '10', 1: '12', 2: '7' });
  const dCols = { stat: 0, c502_dl: 1, c503_dl: 2 };
  const d = e.collectInputsForRow('dachser', dRow, 4, dCols);
  assert.equal(d.c502_dl, '12', 'Einlagern gate cell reaches the training export');
  assert.equal(d.c503_dl, '7', 'Auslagern gate cell reaches the training export');
});

/* ── buildRegressionSet — the solved-row fence shipped as regression.jsonl ── */

test('buildRegressionSet: keeps only engine-solved rows, dedupes, sorts, and preserves silent negatives', () => {
  const mk = (over) => ({
    change: 'changed', sheet: 'S1', row: 5, fw: 'wackler', processor: 'processWackler',
    before: 'x', after: 'x', engineNow: 'x', engineMatchesB: true,
    expected_phrase_keys: ['kontierungQ'], inputs: { stat: '10' }, row_uid: 'u1', source: '',
    ...over,
  });
  const rows = [
    mk({}),                                                          /* solved → kept */
    mk({ row_uid: 'u1' }),                                           /* duplicate uid → dropped */
    mk({ row_uid: 'u2', engineMatchesB: false }),                    /* failing → dropped */
    mk({ row_uid: 'u3', engineMatchesB: null }),                     /* engine not evaluated → dropped */
    mk({ row_uid: 'u4', change: 'sheet' }),                          /* sheet-level warning → dropped */
    mk({ row_uid: 'u5', before: '', after: '', engineNow: '', inputs: {} }), /* padding → dropped */
    mk({ row_uid: 'u6', before: '', after: '', engineNow: '', expected_phrase_keys: [] }), /* silent negative → KEPT */
    mk({ row_uid: 'u7', fw: 'dachser', processor: 'processDachser', sheet: 'A', row: 2 }),
  ];
  const out = A(e.buildRegressionSet(rows));
  assert.deepStrictEqual(out.map((r) => r.row_uid), ['u7', 'u1', 'u6'],
    'forwarder → source → sheet → row sort; solved rows only; uid-deduped');
  const neg = out.find((r) => r.row_uid === 'u6');
  assert.equal(neg.expected, '', 'a row where the engine must stay silent is a regression constraint too');
  const pos = out.find((r) => r.row_uid === 'u1');
  assert.deepStrictEqual(A(pos.expected_phrase_keys), ['kontierungQ']);
  assert.deepStrictEqual({ ...pos.inputs }, { stat: '10' }, 'inputs travel with the constraint');
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

/* ── phraseCellParts — per-phrase table-cell highlighting ── */

test('phraseCellParts: flags only the phrases listed as changed', () => {
  const parts = A(e.phraseCellParts(
    'Mautdifferenz // Portalavisierung, ok?',
    ['Portalavisierung, ok?'],
  )).map((p) => ({ text: p.text, changed: p.changed }));
  assert.deepStrictEqual(parts, [
    { text: 'Mautdifferenz', changed: false },
    { text: 'Portalavisierung, ok?', changed: true },
  ]);
});

test('phraseCellParts: changed-list matching is case/whitespace-insensitive', () => {
  const parts = A(e.phraseCellParts(
    'Differenz  Treibstoff',
    ['differenz treibstoff'],
  ));
  assert.equal(parts.length, 1);
  assert.equal(parts[0].changed, true, 'normPhrase semantics: case + whitespace folded');
  assert.equal(parts[0].text, 'Differenz  Treibstoff', 'original casing/spacing preserved');
});

test('phraseCellParts: empty cell and empty changed list', () => {
  assert.deepStrictEqual(A(e.phraseCellParts('', ['x'])), [], 'empty cell → no parts');
  const parts = A(e.phraseCellParts('Mautdifferenz', []));
  assert.deepStrictEqual(
    parts.map((p) => ({ text: p.text, changed: p.changed })),
    [{ text: 'Mautdifferenz', changed: false }],
    'nothing changed → all phrases neutral',
  );
});

/* ── buildTrainingSummary — AI Bundle failure-pattern aggregation ── */

/* Minimal record shaped like buildTrainingSet output. */
const rec = (over) => ({
  row_uid: 'uid' + Math.random().toString(16).slice(2, 8),
  source_file: '', sheet: 'S1', row: 4, forwarder: 'wackler',
  processor: 'processWackler', label: 'missed',
  engine_label: 'missed',
  engine_missing_phrase_keys: ['differenzEnergiezuschlag'],
  engine_extra_phrase_keys: [],
  engine_missing_phrases: ['Differenz Energiezuschlag'],
  engine_extra_phrases: [],
  missing_phrase_keys: [], extra_phrase_keys: [],
  missing_phrases: [], extra_phrases: [],
  inputs: { stat: '10', tz_diff: '4.2' },
  ...over,
});

test('buildTrainingSummary: groups rows into patterns, solved rows excluded', () => {
  const s = e.buildTrainingSummary([
    rec({ row_uid: 'u1', inputs: { stat: '10', tz_diff: '4.2' } }),
    rec({ row_uid: 'u2', row: 9, inputs: { stat: '10', tz_diff: '7.9' } }),
    rec({ row_uid: 'u3', label: 'correct', engine_label: 'correct',
      engine_missing_phrase_keys: [], engine_missing_phrases: [] }),
  ]);
  assert.equal(s.total_records, 3);
  assert.equal(s.engine_solved, 1, 'engine-correct row counts as solved');
  assert.equal(s.engine_actionable, 2);
  assert.equal(s.pattern_count, 1, 'solved row produces no pattern');
  const p = s.patterns[0];
  assert.equal(p.count, 2);
  assert.equal(p.basis, 'engine_vs_truth');
  assert.equal(p.suggested_action, 'add_or_loosen_branch');
  assert.deepStrictEqual(A(p.missing_phrase_keys), ['differenzEnergiezuschlag']);
  assert.deepStrictEqual(A(p.example_row_uids), ['u1', 'u2']);
});

test('buildTrainingSummary: shared vs varying inputs across a pattern', () => {
  const s = e.buildTrainingSummary([
    rec({ inputs: { stat: '10', tz_diff: '4.2', vkg: '120' } }),
    rec({ inputs: { stat: '10', tz_diff: '7.9' } }),
  ]);
  const p = s.patterns[0];
  assert.deepStrictEqual({ ...p.shared_inputs }, { stat: '10' },
    'identical on every row → gate-signal candidate');
  assert.deepStrictEqual(A(p.varying_inputs), ['tz_diff'],
    'present on every row but differing → varying');
  assert.ok(!('vkg' in p.shared_inputs) && !A(p.varying_inputs).includes('vkg'),
    'keys missing from some rows are omitted');
});

test('buildTrainingSummary: a_vs_b fallback when the engine was not evaluated', () => {
  const s = e.buildTrainingSummary([
    rec({ engine_label: '', engine_missing_phrase_keys: [], engine_missing_phrases: [],
      missing_phrase_keys: ['mautdifferenz'], missing_phrases: ['Mautdifferenz'] }),
  ]);
  assert.equal(s.engine_not_evaluated, 1);
  assert.equal(s.engine_actionable, 0);
  assert.equal(s.pattern_count, 1);
  assert.equal(s.patterns[0].basis, 'a_vs_b');
  assert.deepStrictEqual(A(s.patterns[0].missing_phrase_keys), ['mautdifferenz']);
});

test('buildTrainingSummary: patterns sorted by count desc; fix_both action', () => {
  const wrongRec = () => rec({ forwarder: 'kn', processor: 'processKN', label: 'wrong',
    engine_label: 'wrong',
    engine_missing_phrase_keys: ['kontierung'], engine_missing_phrases: ['Kontierung?'],
    engine_extra_phrase_keys: ['mautdifferenz'], engine_extra_phrases: ['Mautdifferenz'] });
  const s = e.buildTrainingSummary([rec(), wrongRec(), wrongRec()]);
  assert.equal(s.pattern_count, 2);
  assert.equal(s.patterns[0].count, 2, 'largest pattern first');
  assert.equal(s.patterns[0].forwarder, 'kn');
  assert.equal(s.patterns[0].suggested_action, 'fix_both');
  assert.deepStrictEqual({ ...s.by_engine_label }, { missed: 1, wrong: 2 });
});

/* ── normalization hardening — invisible encoding/formatting noise in
   hand-edited truth cells must NEVER create a false training label ── */

test('classifyDiff: Unicode NFC vs NFD forms of the same text are correct', () => {
  const nfc = 'Differenz Telefonische Zustellankündigung - Laderaumzuschlag'.normalize('NFC');
  const nfd = nfc.normalize('NFD');
  assert.notEqual(nfc, nfd, 'precondition: the raw strings differ byte-wise');
  assert.equal(e.classifyDiff(nfc, nfd), 'correct');
});

test('classifyDiff: zero-width / soft-hyphen / NBSP noise is not a rule disagreement', () => {
  assert.equal(e.classifyDiff('Mautdifferenz', 'Maut\u200bdifferenz'), 'correct', 'zero-width space');
  assert.equal(e.classifyDiff('Mautdifferenz', 'Maut\u00addifferenz'), 'correct', 'soft hyphen');
  assert.equal(e.classifyDiff('Differenz treibstoff', 'Differenz\u00a0treibstoff'), 'correct', 'NBSP');
});

test('classifyDiff: en/em-dash variants fold to the ASCII hyphen', () => {
  assert.equal(e.classifyDiff('Termin-zuschlag', 'Termin–zuschlag'), 'correct', 'en dash');
  assert.equal(e.classifyDiff('Termin-zuschlag', 'Termin—zuschlag'), 'correct', 'em dash');
});

test('classifyDiff: separator-only cells count as empty', () => {
  assert.equal(e.classifyDiff(' // ', ''), 'correct', 'garbage vs empty is an empty-set match');
  assert.equal(e.classifyDiff('//', 'x'), 'missed', 'garbage vs filled is a full miss');
});

test('granularLabel: separator-only cells agree with classifyDiff', () => {
  const g = (a, b) => e.granularLabel(a, b, e.computePhraseDiff(a, b));
  assert.equal(g(' // ', ''), 'empty_match', 'top label is correct — granular must not say overfired_full');
  assert.equal(g('', ' // '), 'empty_match');
  assert.equal(g(' // ', 'x'), 'missed_full');
  assert.equal(g('x', ' // '), 'overfired_full');
});

test('granularLabel: NFC/NFD pair of the same visible text lands in the match family', () => {
  const nfc = 'Gebühr für vergeblichen Abholversuch'.normalize('NFC');
  const nfd = nfc.normalize('NFD');
  const lbl = e.granularLabel(nfc, nfd, e.computePhraseDiff(nfc, nfd));
  assert.ok(['case_only', 'whitespace', 'reordered'].includes(lbl),
    'must be a cosmetic match label, was: ' + lbl);
});

/* ── phraseToKey / phraseKeysFor — key resolution must share normPhrase
   semantics with the diff, or noisy catalog phrases export as ?: sentinels
   and split one failure pattern into two in buildTrainingSummary ── */

test('phraseToKey: whitespace / case / unicode noise still resolves to the catalog key', () => {
  assert.equal(e.phraseToKey('Differenz  treibstoff'), 'treibstoff', 'double space');
  assert.equal(e.phraseToKey('  MAUTDIFFERENZ '), 'mautDiff', 'case + padding');
  const nfd = 'Differenz Telefonische Zustellankündigung - Laderaumzuschlag'.normalize('NFD');
  assert.equal(e.phraseToKey(nfd), 'snkTelAnk', 'NFD umlauts');
  // en-dash variant of a still-hyphenated catalog phrase folds back to its key
  // (terminZuschlag dropped its hyphen in v1.29.0, so use snkTelAnk's " - " here).
  assert.equal(e.phraseToKey('Differenz Telefonische Zustellankündigung – Laderaumzuschlag'), 'snkTelAnk', 'en dash');
});

test('phraseToKey: compound catalog phrases resolve per ' + "' // '" + ' half', () => {
  assert.equal(e.phraseToKey('Eelevated risk ok?'), 'elevatedRestricted');
  assert.equal(e.phraseToKey('Restricted destination ok?'), 'elevatedRestricted');
});

test('phraseToKey: exact-case match wins over the case-folded Kontierung collision', () => {
  assert.equal(e.phraseToKey('Kontierung?'), 'kontierungQ', 'K+N casing');
  assert.equal(e.phraseToKey('kontierung?'), 'kontierungLower', 'DHL casing');
});

test('phraseToKey: legacy literals and templates still resolve through the fold', () => {
  assert.equal(e.phraseToKey('DifferenzTreibstof'), 'lit_differenzTreibstofWackler', 'glued legacy literal');
  assert.equal(e.phraseToKey('Differenz aufgrund abweichender Zwischenempfänger 12345 Berlin'), 'zwPrefix', 'template');
});

test('phraseKeysFor: no ?: sentinel for noisy catalog phrases', () => {
  assert.deepStrictEqual(A(e.phraseKeysFor(['Differenz  Treibstoff'])), ['treibstoff']);
  assert.deepStrictEqual(A(e.phraseKeysFor(['totally unknown phrase'])), ['?:totally unknown phrase'],
    'genuinely unmapped phrases still surface as sentinels');
});

test('PHRASES catalog: normPhrase folding never merges two distinct branches (known exception: Kontierung case pair)', () => {
  const seen = new Map(); const collisions = [];
  for (const [k, v] of Object.entries(e.PHRASES)) {
    for (const part of String(v).split(/\s*\/\/\s*/).map((s) => s.trim()).filter(Boolean)) {
      const f = e.normPhrase(part);
      if (seen.has(f) && seen.get(f) !== k) collisions.push(f);
      else seen.set(f, k);
    }
  }
  assert.deepStrictEqual(collisions, ['kontierung?'],
    'a new catalog entry must not case/whitespace/dash-fold onto an existing branch — that would make two rule outputs indistinguishable to the diff');
});
