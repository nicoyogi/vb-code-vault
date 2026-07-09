# File Splitter — shuffle deals contiguous document-number bands

**Date:** 2026-07-07 · **Tool:** `File_splitter.html`

## Goal

With **Shuffle rows** on, each person currently receives a fully random scatter
of rows — their document numbers jump all over the range. Keep the shuffle's
fairness (nobody can predict or pick their share) but stop scattering document
numbers: each person's share should cover a **compact, contiguous
document-number band** per system.

## Behavior

Shuffle on, per system:

1. The filtered pool is sorted by **Document number Z→A** (existing
   `docNumDesc` — numeric-aware, blanks last).
2. The pool is cut into **contiguous [start, end) bands** with balanced sizes
   (new pure helper `sliceBounds`, built on `balancedSizes`).
3. Each interior band cut is **nudged off runs of equal document numbers**
   (new pure helper `snapBoundsToDocRuns`): the pool is doc-sorted, so a
   document's rows are adjacent, and the cut moves to the nearer run edge —
   rows of the same document always stay with one person. Blank document
   numbers are unrelated rows and may still split. A run longer than a band
   empties that band rather than splitting the document.
4. The **band→person assignment is shuffled**, not the rows. Randomness now
   also decides who gets the +1 remainder rows (previously always the
   first-listed people).

Shuffle off: unchanged — source-order slices.

Unchanged everywhere: balanced share sizes, per-sheet output sorting
(forwarder A→Z, doc Z→A), PRIO marking, tariff/factual jobs, recap chips.
The toggle label is reworded to describe the band behavior.

## Non-goals

- No new UI — same single Shuffle toggle.
