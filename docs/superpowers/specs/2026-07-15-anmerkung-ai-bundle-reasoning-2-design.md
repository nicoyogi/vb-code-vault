# Anmerkung AI Bundle — Reasoning Improvements, Round 2

Date: 2026-07-15 · Target: `assets/anmerkung.js` AI Bundle pipeline · Follows PR #199.

## 1. Phrase → emitter index (`rule_spec.json.phrase_emitters`)

Map every phrase key to the function(s) that emit it, scanned from the live
source at export time:

- The function list is shared with `buildEngineSourceDoc` — and is ENUMERATED
  from the global scope by naming convention (`process*`/`resolve*`/`da*`/
  `kn*`/`dhl*`/`wackler*`), not hand-listed: during implementation the v1.31
  hand-list turned out to have silently missed `daEvalSNK` and `daZWNote`, so
  `engine_source.md` was incomplete too. Enumeration fixes both for good.
- `P.<key>` token scan over each function's `toString()` → catalog keys.
- Phrase-string scan: catalog phrases and `PHRASE_LITERALS` are substring-
  matched (case-insensitive) against each function source and against the
  `WACKLER_SNK_CODES` code book (whose labels are emitted via
  `wacklerSnkCode`, not from any function body).
- `PHRASE_TEMPLATES` already carry a `processor` field — used directly.
- Every `PHRASES` key appears in the index; `[]` means *no branch emits this
  yet* (the fix is a new branch, not a gate change). All 77 keys currently
  resolve — pinned by test.

## 2. Signature hypothesis per pattern (`summary.json`)

Each pattern gains `signature_hypothesis`: a machine-drafted conjunction
describing the failing rows, pre-checked against the pattern's contrast rows.

- Predicates: `{key, op:'==', value}` for every `shared_inputs` entry;
  `{key, op:'sign', value}` for every non-shared `numeric_profiles` key with a
  consistent sign; `{key, op:'beyond_threshold', threshold}` where
  `all_beyond_threshold` is true.
- `readable` — human/AI-readable one-liner, e.g.
  `stat == "10" && fr_diff < 0 && |fr_diff| > 1.5`.
- Pre-check counts (not verdicts — interpretation depends on
  `suggested_action`): `contrast_rows_matching / _total` and
  `silent_rows_matching / _total`, evaluated on the regression rows' `inputs`.
  For a *missed* pattern a good gate matches the contrast rows and no silent
  row; for an *overfired* pattern the guard must NOT match the contrast rows.
- `null` when no predicate can be drafted.

## 3. Not-derivable ledger

Rows the AI judged "not derivable from row inputs" stop being re-attempted
every iteration:

- localStorage `anm_not_derivable_v1`: `{ row_uid: {reason, added} }`, same
  try/catch pattern as thresholds.
- UI: native `<dialog>` with one textarea (one `row_uid: reason` per line — the
  textarea IS the ledger editor; save replaces the whole map), opened from a
  new button next to *AI Bundle (ZIP)* in the Diff toolbar. Button shows the
  ledger count.
- `buildTrainingSet` flags matching records `known_not_derivable: true` (+
  `known_not_derivable_reason`). Flag is NOT part of the uid seed (it is not an
  input) — uids stay stable.
- `buildTrainingSummary` counts `known_not_derivable_rows` per pattern.
- Bundle gains `not_derivable.json` (the ledger, when non-empty).
- prompt.md/README: deprioritise flagged rows; a pattern where every row is
  flagged is not a rule bug — do not force a gate for it.

## Verification

Tests: emitter index (catalog coverage, `terminZuschlag → daEvalEXP`, template
processor mapping), hypothesis (predicate drafting, readable string, contrast /
silent match counts, null case), summary ledger counting. Harness exports
`buildPhraseEmitterIndex`. `node --test "tests/*.test.mjs"`. Changelog →
v1.32.0.

## Out of scope

Replay script in the bundle (deferred); cross-machine ledger sync (localStorage
only — Firestore later if the ledger needs to be shared).
