# Half-Day People — File Splitter

Date: 2026-09-11

## What

Let each person in the File Splitter be marked **half-day** so their share of
the rows is half a full-day person's. No time-cost model: a half-day person
simply receives half as many rows.

## Where

Step 5 ("Who gets a share?"). A small toggle on each person row marks that
person half-day. The sharing math in `systemShares()` / `sliceBounds()` is
weighted by each person's capacity.

## Behavior

- **Toggle:** one `toggle` slider per person row, next to their name input,
  default OFF. Applies within the Tariff and Factual people lists
  independently (same as names today).
- **Weighting:** a half-day person has weight `0.5`, a full-day person `1.0`.
  Shares are sized proportional to weight: sizes are `weight_i / sum(weights)`
  of the pool, rounded by the largest-remainder method so shares stay within
  ±1 of exact proportion and every person with a share gets rows when the pool
  can supply them.
  - 1 full + 1 half over 9 rows → `[6, 3]`.
  - 2 full + 1 half over 10 rows → `[4, 4, 2]`.
  - All-full (default) → exactly today's `balancedSizes` behavior.
- **Both pools:** the PRIO pool and the main pool are each cut with the same
  weighted bands. PRIO rows stay balanced relative to each person's capacity,
  and document-band snapping (`snapBoundsToDocRuns`) is unchanged.
- **Recap chip** (Step 6): shows the weight mix, e.g. `3 people (2 full ·
  1 half)` instead of a bare count.
- **Unchanged:** everything else — forwarder/note/Kreditor/Referenz filtering,
  shuffle, blank-skip, per-person files, result cards, PRIO marking. Output
  options (Skip blanks, Shuffle) are global, not per-person.

## Implementation

- Replace `sliceBounds(n, parts)` with `sliceBounds(n, weights)` — weights are
  `[half? 0.5 : 1, ...]` per person. Sizes via proportional split with
  largest-remainder rounding; boundaries accumulate sizes as today.
- Add a `halfChecked` map (per `data-group`) in Step 5; the toggle echoes into
  it on change and re-renders the wizard.
- Pass the weight list into `systemShares(rows, weights, doShuffle, isPrioRow)`
  (replacing the `parts` count) so both the PRIO and main pools are cut with
  `sliceBounds(pool.length, weights)`.
- Step 6 recap: `renderRecap()` includes the full/half counts per group chip.
- Tests: `tests/splitter.test.mjs` gains weighted `sliceBounds` cases — 2:1,
  2:2:1, sum invariant, single person, and the all-full case equal to the old
  `balancedSizes` output.

## Testing

Extend `tests/splitter.test.mjs`:

- `sliceBounds(n, weights)` → correct bands for `[1, 0.5]`, `[1, 1, 0.5]`,
  single person `[0.5]`, and all-full `[1,1,1]` matching the previous
  `balancedSizes(n, 3)`.
- `systemShares` with mixed weights: half-day share ≈ half the full-day share
  within ±1 in both the PRIO and main pools; every row covered exactly once.
- All-full weights reproduce today's split exactly.

## Non-goals

- No time-cost / minutes-per-row model (explicitly dropped).
- No per-system capacity, no half-day file names or AM/PM batches.
- No half-day persistence across sessions — the toggle lives with the person
  list, which is already saved in localStorage by name; the half flag is
  re-entered when names are set up.