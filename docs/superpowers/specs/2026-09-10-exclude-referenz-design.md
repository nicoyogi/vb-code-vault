# Exclude Referenz — File Splitter

Date: 2026-09-10

## What

Add a per-system **Referenz exclusion** to the File Splitter so rows whose
Reference column value matches an excluded entry are not extracted — matching
the existing Kreditor exclusion mechanism.

## Where

Step 3 of the wizard. The existing "Exclude Kreditor" card becomes a grouped
**"Exclusions"** card: a Kreditor (Supplier) textarea and a Referenz (Reference)
textarea per system, side by side. The wizard still has 6 steps; the step
label/stepper stays "Step 3 of 6".

## Behavior

- **Matching:** exact, case-insensitive, after trimming — the input is
  normalized exactly like the Kreditor list (`normDoc`), and each row's
  Reference value (row index 2 of the normalized `[vendor, supplier, ref, doc,
  notes[], overdue]` row) is compared the same way. One value per line or
  comma-separated.
- **Scope:** applies to every row the system contributes — Tariff **and**
  Factual, including PRIO-injected rows. The Referenz exclusion runs inside
  `splitRows()` at the same spot Kreditor exclusion runs today (row-level
  filter before forwarder/note filtering), so it applies everywhere
  `splitRows()` is used — totals, per-person shares, and the split output.
- **Persistence:** identical to Kreditor — `localStorage` immediately under
  `fileSplitter.referenz`, plus a debounced Firestore sync into a new shared
  doc `wmf_splitter_config/referenz` (`{ lists: { systemName: rawText } }`) so
  the team shares the same exclusions. Firestore console rules for the new doc
  are required once before cloud sync works (silent local fallback otherwise —
  same caveat as the existing Kreditor doc).

## Implementation

- Add `referenzStore` behind the same load/save/init pattern as `kreditorStore`
  (localStorage key `fileSplitter.referenz`, Firestore doc
  `wmf_splitter_config/referenz`).
- Add a `referenzSetFor(name)` helper mirroring `kreditorSetFor(name)`.
- Extend `splitRows()` with a `referenzExcl` parameter that drops rows whose
  Reference (row index 2) is in the set — applied in every group, same as
  Kreditor. Callers pass `referenzSetFor(sys.name)`.
- Extend `renderKreditor()` into `renderExclusions()` rendering one block per
  system with two textareas (Kreditor + Referenz) and per-field hit stats.
- Update Step 3 card markup and copy to describe both exclusions.

## Testing

Extend `tests/splitter.test.mjs`:

- `parseReferenz`/`referenzSetFor` split/trim behavior (mirror
  `parseKreditors`).
- `splitRows` applies the Referenz exclusion in Tariff and Factual groups
  (mirror the existing Kreditor test), numeric Reference cells match via
  `normDoc`, and omitting the arg leaves behavior unchanged.

## Non-goals

- No substring/prefix matching, no per-person Referenz lists, no UI change to
  other steps, no migration of existing Kreditor data.