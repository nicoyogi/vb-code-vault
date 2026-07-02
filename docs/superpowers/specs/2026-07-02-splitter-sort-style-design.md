# File Splitter → Z-A document order + styled Excel output

**Date:** 2026-07-02
**File touched:** `File_splitter.html`, `tests/splitter.test.mjs`
**Branch:** `feat/splitter-note-checklist` (appended to open PR #180)

## Problem

The Shuffle toggle randomizes row order to give every person a spread of
forwarders — but that also randomizes the visible order of the output
sheets. The user needs each person's sheet ordered by **Document number
Z→A** (descending), never random. The generated workbooks are also
completely unstyled.

## Decision (from brainstorming)

1. **Sort after slicing, always.** Shuffle keeps its distribution role
   (who gets which rows); each person's per-system chunk is then sorted
   descending by Document number before writing. Applies with Shuffle on
   or off. The toggle's description text is updated to say the sheets are
   re-sorted afterwards. Forwarder-block shuffling was rejected — it would
   reduce the forwarder spread the shuffle exists for.
2. **Styling via `xlsx-js-style`.** The CDN script swaps from cdnjs
   `xlsx/0.18.5/xlsx.full.min.js` to
   `https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js` —
   a drop-in fork of the same SheetJS 0.18.5 (same global `XLSX`, same
   read/write API) that additionally writes cell styles (`cell.s`).
   JSZip stays for the ZIP download.

## Output styling (exact values)

- **Header row:** `font: { bold: true, color: { rgb: 'FFFFFF' } }`,
  `fill: { fgColor: { rgb: '262626' } }`, thin borders.
- **Data cells:** thin borders only.
- **All borders:** `{ style: 'thin', color: { rgb: 'B0B0B0' } }` on
  top/bottom/left/right.
- **Column widths:** per column, `wch = clamp(maxContentLength + 2, 12, 44)`
  measured over the header cell and every data cell (stringified).
- **Autofilter:** over the used range including the header row
  (`A1:C1` for an empty sheet, `A1:C{n+1}` for n data rows).

## Sort semantics

`docNumDesc(a, b)` compares projected rows by index 2 (Document number),
descending, numeric-aware:
`String(b[2] ?? '').localeCompare(String(a[2] ?? ''), undefined, { numeric: true, sensitivity: 'base' })`.
- `"10"` sorts above `"9"` (numeric-aware), real numbers coerce via String.
- Blank/missing document numbers sort last (empty string is smallest, so
  Z→A puts them at the bottom).

## Implementation notes

- New pure helpers (top-level, vm-harness-testable, no `XLSX` usage):
  - `docNumDesc(a, b)` — comparator above.
  - `colWidths(header, rows)` — `[{ wch }, …]` per column, caps 12/44.
- In `splitFile`, per person per system: `chunk = rows.slice(start, end)`
  then `chunk.sort(docNumDesc)`; after `aoa_to_sheet`, loop the used range
  to set `cell.s` (header style row 0, data style below), set
  `ws['!cols'] = colWidths(TARGET_COLS, chunk)` and `ws['!autofilter']`.
- Toggle copy: "Shuffle rows — randomly mix who gets which rows; every
  sheet is re-sorted by Document number (Z→A) after splitting".
- Notes (`r[3]`) never sorted into output — the slice to 3 columns is
  unchanged.

## Edge cases

- Empty chunk → header-only sheet: header still styled, widths from
  header lengths, autofilter `A1:C1`, sort is a no-op.
- Document numbers arriving as JS numbers (SheetJS cell values) — the
  comparator and width calc both `String()`-coerce.
- The in-place `chunk.sort` mutates only the person's slice copy
  (`rows.slice`), never the shared pool.

## Verification

- `node --test "tests/*.test.mjs"` — new comparator/width cases pass,
  no regressions.
- Browser: seed fake systems, run a real split, then in the page parse a
  generated blob back with `XLSX.read` and assert: rows Z→A by document
  number, `!cols` present, header cell `.s.font.bold` true (xlsx-js-style
  reads styles back with `cellStyles: true`).
- User: open a real output workbook in Excel — dark bold header, borders,
  sensible widths, filter arrows, doc numbers descending.
