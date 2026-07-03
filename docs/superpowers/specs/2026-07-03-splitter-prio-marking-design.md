# File Splitter — PRIO list marking + fixed system order

**Date:** 2026-07-03 · **Tool:** `File_splitter.html`

## Goal

1. Accept an optional **PRIO workbook** (the daily `PRIO dd.mm.yyyy !!!.xlsx`). Rows in
   the split output whose Document number appears on the PRIO list are marked so people
   work them first.
2. Order the step-1 system cards (each carries its forwarder filter) and the output
   sheets in the fixed operational order **FNP → KSP → OPP → PS1** instead of upload
   order. Unknown system names follow after, in upload order.

## PRIO workbook format (observed)

- Several sheets: one per day (`25.06.2026`, `02.07.2026`, …) plus ad-hoc lists
  (`OPP K&N`). All sheets are read; doc numbers are unioned into one set.
- Each relevant sheet has a header cell `Dokumentnummer` (ad-hoc sheets may place it in
  column A, daily sheets in column G); `Document number` is accepted too.
- The used range can be stretched to ~1M blank rows, so parsing walks the sheet's
  actual cells, never `!ref`.

## Behavior

- **Step 1** gets an optional "PRIO list" picker under the systems list. Loaded state
  shows file name + distinct doc-number count, with a × to remove. No PRIO file loaded
  ⇒ output is byte-for-byte the same as today.
- **Matching:** `String(docNumber).trim()` equality, one global set (doc-number ranges
  don't collide across systems in practice).
- **Output marking** (only when a PRIO list is loaded): a 4th column `PRIO` holds
  `PRIO` on matching rows; the Document number and PRIO cells of those rows get a
  yellow fill (`FFFF00`). Column D is autofilterable, so "filter → PRIO" finds them.
- **Recap step** shows a `PRIO list · n matches` chip (counted after forwarder/note/
  blank filters) so a uselessly-unmatched PRIO file is visible before splitting.
- Repeated `Dokumentnummer` header cells inside one column (stacked exports) are
  skipped as values.

## Non-goals

- No per-system scoping of PRIO matches, no per-person PRIO counts on result cards,
  no drag-drop on the PRIO picker, no persistence of the PRIO list.
