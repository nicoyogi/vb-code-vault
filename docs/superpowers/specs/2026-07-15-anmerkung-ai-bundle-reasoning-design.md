# Anmerkung AI Bundle — Reasoning Improvements

Date: 2026-07-15 · Target: `assets/anmerkung.js` (AI Bundle pipeline) · Approved in-session.

Goal: the bundle an AI consumer receives should carry the *reasoning material* for
rule fixes — numeric gate signals, counter-examples, and the actual gate source —
not just labels and prose instructions.

## 1. Numeric profiles per pattern (`buildTrainingSummary`)

`varying_inputs` today is a bare key list; the numeric signal is discarded.
For every input key present on **all** rows of a pattern, whose key is
numeric-typed (`vkg`, `tarif`, `anz_sdg`, `stat`, or ends in `_diff`/`_dl`/`_tarif`)
and whose values all parse as plain numbers (German decimal comma accepted),
emit into `numeric_profiles`:

```json
"numeric_profiles": {
  "fr_diff": { "min": -31.65, "max": -2.1, "sign": "all_negative", "all_beyond_threshold": true }
}
```

- `sign`: `all_negative` / `all_positive` / `all_zero` / `mixed`
- `all_beyond_threshold`: only on `*_diff` keys — every `|value| >` the pattern's
  `applicable_threshold` (the `hasErr` predicate)
- Keys stay in `shared_inputs`/`varying_inputs` unchanged; purely additive.
- Text-typed keys (`referenz`, `empf_plz`, `zone`, …) are never profiled, even when
  their values happen to parse (`referenz: "123,456"` is a ref list, not a number).
- Schema bumps to `anmerkung.training-summary/v2`.

## 2. Contrast rows per pattern

`buildTrainingSummary(records, regression)` gains an optional second argument
(the `buildRegressionSet` output; stays pure). Per pattern:

- `contrast_row_uids` — up to 5 same-forwarder regression rows whose
  `expected_phrase_keys` intersect the pattern's `missing ∪ extra` keys: solved
  rows where the disputed phrase fires legitimately — the working gate signature.
- `silent_contrast_row_uids` — up to 2 same-forwarder regression rows with empty
  `expected`: the silence pins an overeager gate loosening breaks first.
- Both are `[]` when no regression set is passed.

`downloadAiBundle` builds the regression set before the summary and passes it in.

## 3. `engine_source.md` in the bundle

New pure builder `buildEngineSourceDoc()` assembles the exact current source of
the symbols an AI edits, via `Function.prototype.toString()` (cannot drift from
the shipped engine): the four processors, four resolvers, per-forwarder helpers
(tier/lane/rate/code-book), shared helpers (`hasErr`, `join`, `normPhrase`), and a
JSON block of the gate constants (`WACKLER_*` tolerances, `DA_COL_*`).
One `### symbol` heading + fenced `js` block per function. Zipped into the bundle.

## 4. Prompt + README rework

- `prompt.md`: per-pattern hypothesis→verify loop — (a) hypothesise the gate from
  `shared_inputs` + `numeric_profiles`, (b) verify against `contrast_row_uids`
  (must keep firing) and `silent_contrast_row_uids` (must stay silent), (c) only
  then patch, citing the rows replayed. `engine_source.md` is the ground truth for
  current gates. Existing hard rules (normPhrase, PHRASES-only, "not derivable")
  stay.
- `README.md`: document `numeric_profiles`, `contrast_row_uids`,
  `silent_contrast_row_uids`, and the new file.

## Verification

`tests/diff.test.mjs`: numeric-profile computation (signs, threshold flag, German
decimals, text keys excluded), contrast-row selection (intersection, caps, silent
rows), schema v2, and `buildEngineSourceDoc` sanity (contains `processWackler`,
fenced blocks). Harness exports `buildEngineSourceDoc`. Run
`node --test "tests/*.test.mjs"`. Changelog → v1.31.0.

## Out of scope

Histogram/quantile stats, nearest-neighbour input similarity for contrast rows
(revisit if key-intersection proves too coarse), shipping the full source file.
