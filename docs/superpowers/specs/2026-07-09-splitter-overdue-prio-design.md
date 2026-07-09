# File Splitter — Date-Based PRIO Marking (Overdue in workflow from)

**Date:** 2026-07-09
**Status:** Approved
**File:** `File_splitter.html`

## Problem

Input exports carry an optional `Overdue in workflow from` column (a date).
Rows at or near their overdue date need the same yellow `PRIO` mark the
PRIO-list workbook already produces — today only an uploaded PRIO list can
mark rows, and the overdue date is ignored entirely.

## Rule

For each row, with `diff = today − (Overdue in workflow from)` in whole
calendar days:

- **`diff ≥ -5` → the row is PRIO.**
  - `diff > 0`: the overdue date has passed — already overdue.
  - `-5 ≤ diff ≤ 0`: goes overdue within the next 5 days.
  - `diff < -5`: overdue date more than 5 days away — not PRIO.
- Blank, missing, or unparseable dates → not PRIO.
- "Today" is read when the split/recap runs (browser date), not at upload.

Confirmed against the example `Book1.xlsx`: overdue date 7/13/2026 with
today 2026-07-09 gives `diff = -4` → all 15 data rows marked PRIO.

## SheetJS date quirk — round, don't truncate

`xlsx-js-style@1.2.0` (the build the splitter loads) converts Excel serial
dates to JS Dates that can land seconds **before** midnight of the actual
day — Book1's 7/13/2026 reads back as 7/12 23:59:48 local. Truncating
time-of-day would shift such dates a day early, so `prioByDate` rounds the
parsed timestamp to the **nearest** calendar day instead. Excel dates are
whole days, so nearest-day rounding always recovers the true date.

## Two triggers, one mark

The date rule merges with the existing PRIO-list mechanism:

- A row gets the `PRIO` mark if it matches the uploaded PRIO list **or** the
  date rule fires — one shared `PRIO` output column, same yellow styling.
- The date rule works standalone: if any uploaded system carries the
  `Overdue in workflow from` column, the PRIO column appears in the output
  even with no PRIO list uploaded.

## Changes (`File_splitter.html`)

- **Column pickup:** `workbookEntries` additionally locates the optional
  `Overdue in workflow from` header (exact trimmed match, like the other
  columns). Missing column ⇒ behavior unchanged.
- **Row shape:** `extractRows` carries the row's overdue value as a 6th
  element: `[vendor, supplier, reference, doc, notes, overdue]`.
- **New pure helper** `prioByDate(overdue, today)` — accepts a Date instance
  (from `cellDates: true`) or a parseable date string, rounds both sides to
  the nearest calendar day, returns `today − overdue ≥ -5` days. Anything
  unparseable returns false.
- **New helper** `isPrio(row)` — PRIO-list doc-number match OR
  `prioByDate(row[5], today)`.
- **Output & recap:** the split output's PRIO column and the recap chip
  (`PRIO · N matches`) both use `isPrio`. The column/chip render when a PRIO
  list is loaded **or** any valid system has at least one overdue value.

## Testing

Unit tests in `tests/splitter.test.mjs` via the existing
`tests/harness/load-splitter.mjs` vm harness:

- `prioByDate` boundaries (diff = today − overdue): overdue 6 days ahead
  (diff −6) → false; 5 days ahead (−5) → true; today (0) → true; 3 days past
  (+3) → true; blank / garbage input → false; string dates parse.
- The SheetJS quirk: a Date at 23:59:48 the day before must count as the
  following day (nearest-day rounding).
- Extraction carries the overdue value at index 5, and behaves unchanged
  when the column is absent.

## Out of scope

- No new UI controls — the rule is always on when the column exists.
- The −5 threshold is a constant, not user-configurable.
