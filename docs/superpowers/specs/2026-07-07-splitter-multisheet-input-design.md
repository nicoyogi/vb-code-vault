# File Splitter — combined-workbook input (one sheet per system)

**Date:** 2026-07-07 · **Tool:** `File_splitter.html`

## Goal

Bring back the original splitter's input shape: **one Excel file whose sheets are
the systems** (e.g. `FNP` / `KSP` / `OPP` / `PS1`), alongside the current
one-file-per-system uploads. Today `handleFile` reads only the first sheet of a
workbook; a combined export loses three of its four systems silently.

## Behavior

A new pure helper `workbookEntries(sheets, fileName)` decides what an uploaded
workbook contributes (`sheets` = `[{ name, rows }]` for every sheet):

- A sheet **qualifies** when it carries the 4 target columns
  (`Vendor details`, `Supplier`, `Reference`, `Document number`) — same
  `pickColumns` rule as today. Non-qualifying sheets are skipped.
- **More than one qualifying sheet** → combined export: each qualifying sheet
  becomes its own system entry, **named after the sheet** (trimmed).
- **Exactly one qualifying sheet** → classic upload: the system keeps the
  **filename** naming (`systemName`), so existing one-file-per-system exports
  behave exactly as before — including workbooks that carry stray
  pivot/summary sheets next to the data sheet.
- **No qualifying sheet** → one error card. Single-sheet workbooks keep the
  existing per-missing-column message; multi-sheet workbooks say no sheet has
  the required columns.
- Per qualifying sheet, rows partition into tariff/factual entries exactly like
  a standalone file (`partitionByStep` + `extractRows`); a qualifying sheet
  whose partitions all extract empty keeps one 0-row tariff card so the upload
  stays visible.

Everything downstream is untouched: per-group name de-duplication, forwarder
checklists, note filter, totals, people lists, PRIO marking, FNP→KSP→OPP→PS1
ordering, and the per-person output (one workbook per person per work type,
one sheet per system).

Step-1 copy is updated to mention both input shapes (card description +
dropzone hint).

## Non-goals

- No per-sheet include/exclude UI — remove unwanted system cards instead.
- No hidden-sheet filtering; a hidden sheet with the 4 columns counts (its
  card can be removed manually).
- No change to output file/sheet naming.
