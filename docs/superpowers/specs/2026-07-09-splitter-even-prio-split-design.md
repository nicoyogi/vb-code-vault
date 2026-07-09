# File Splitter — Even PRIO Distribution Across People

**Date:** 2026-07-09
**Status:** Approved
**File:** `File_splitter.html`
**Builds on:** `2026-07-09-splitter-overdue-prio-design.md` (the `isPrio` mark, PR #189) and the doc-band shuffle (PR #188).

## Problem

The split cuts each system's pool into contiguous doc-number bands, so PRIO
rows (PRIO-list matches or overdue dates within the window) can cluster:
whoever draws the band holding the urgent documents gets all of them. PRIO
work should be shared out evenly instead.

## Rule

Per system, after the forwarder/note/blank filters run:

- Partition the surviving rows into **PRIO rows** and **rest rows**, using
  the same `isPrio` check that drives the output mark (PRIO-list doc match
  OR `prioByDate` window).
- Split **each pool independently** with the existing band machinery:
  - Shuffle ON: doc-sort the pool (`docNumDesc`), cut into balanced
    contiguous bands (`sliceBounds`), nudge cuts off equal-doc runs
    (`snapBoundsToDocRuns`), assign bands to people at random — each pool's
    band→person assignment shuffles independently, so no one collects both
    remainders.
  - Shuffle OFF: plain in-order balanced slices per pool, remainder to the
    front (today's no-shuffle behavior, applied per pool).
- Person *i* receives their PRIO band plus their rest band; output sheets
  re-sort by `outputRowOrder` as today.

**Active** whenever PRIO marking is active (`prioColumnOn`) — with the
Shuffle toggle on or off. A system with zero PRIO rows degrades to a single
pool, exactly today's behavior. No new UI.

## Guarantees and accepted tradeoffs

- PRIO rows per person balanced to ±1 (before doc-run nudges — same
  tradeoff PR #188 accepted for totals).
- Total rows per person balanced to ±2 (two pools, each ±1).
- Every row lands with exactly one person.
- One document stays with one person **within each pool**. A document
  carrying both PRIO and non-PRIO rows can split across pools — rare, since
  PRIO-list matches are whole-document and same-document rows share their
  overdue date. Accepted.

## Changes (`File_splitter.html`)

- **New pure helper** `systemShares(rows, parts, doShuffle, isPrioRow)` →
  array of `parts` row-arrays. Extracts the inline pool/bounds bookkeeping
  from `splitFile` and adds the two-pool partition. `isPrioRow` is a
  predicate (row) => boolean; `splitFile` passes
  `r => isPrio(r, prio && prio.docs, today)` when `prioColumnOn`, else a
  constant-false predicate (single pool).
- **`splitFile`:** replace the `pool`/`bounds` maps with one
  `systemShares` call per system; the per-person loop slices become direct
  indexing into the returned shares.

## Testing

Unit tests on `systemShares` in `tests/splitter.test.mjs` (vm harness):

- PRIO counts per share balanced to ±1; totals ±2; all rows covered exactly
  once (multiset equality with input).
- Doc runs intact within each pool when shuffled.
- Shuffle OFF: deterministic in-order slices per pool.
- Zero PRIO rows → identical to the single-pool split.
- `parts` > row count (empty shares) handled.

E2E: Book1.xlsx re-check (15 PRIO rows across N people → counts differ by
at most 1).

## Out of scope

- No per-person PRIO counts in the results UI.
- No control to turn even-PRIO distribution off.
