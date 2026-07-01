# File Splitter → per-system forwarder extract + people split

**Date:** 2026-07-01
**File touched:** `File_splitter.html` (single-file tool, Siemens GP · Tome III)

## Problem

The user works freight-invoice tariff checking across four SAP systems (OPP, PS1,
KSP, FNP). Each system exports one Excel file with a single sheet, ~30–50 columns,
hundreds of rows. The useful extract is only three columns — `Vendor details`,
`Supplier`, `Document number` — and only for a chosen subset of forwarders
(the vendor/Spediteur in `Vendor details`). Today that extract is assembled by
hand (see `tarif.xlsx`: one sheet per system, 3 columns, filtered rows).

The existing File Splitter takes **one** arbitrary Excel and splits all its columns
evenly across people. The user wants the tool to instead: take the **per-system**
files, reduce each to the 3 columns filtered to picked forwarders, then split that
across people — one workbook per person, one sheet per system, their share of rows.

## Decision (from brainstorming)

- **Core transform:** confirmed — combined per-system sheets, 3 columns, rows
  filtered by forwarders picked per system (the `tarif.xlsx` shape).
- **Output:** per-person only. No separate merged workbook.
- **Packaging:** fully replace the current generic single-file behavior. One clean
  flow, no mode toggle.

## Flow

Four cards, top to bottom.

### 1. Upload — multiple files
- `<input type="file" multiple accept=".xlsx,.xls">`, drag-drop supports multiple.
- Each file = one **system**. System / output-sheet name = filename base,
  uppercased trailing extension stripped (`OPP.XLSX` → `OPP`), matching `tarif.xlsx`.
- Read the **first sheet** of each file. Find the header row (first non-blank row,
  as the current code does). Locate the 3 target columns **by exact header name**
  (`Vendor details`, `Supplier`, `Document number`) — column positions differ per
  system (verified: OPP 6/19/5, PS1 6/25/5, KSP 6/31/5, FNP 6/34/5), so match by
  name, never index.
- A file missing any of the 3 names → red "column not found" badge, excluded from
  the split. Other files still process.
- Duplicate base names → second gets a `_2` suffix.

### 2. Forwarders — per system
- Under each uploaded file, a checklist of that system's **distinct `Vendor details`
  values** with row counts, e.g. `Schenker Deutschland AG, Nuernberg — 118`.
- **Verbatim strings**, no casing/spelling normalization. `tarif.xlsx` keeps the
  vendor string exact, and different city branches (`…, Hamburg` vs `…, Nuernberg`)
  are genuinely different rows the user may want independently.
- Default: **all checked**. Per-system **Select all / Clear** buttons and a
  **search box** to filter the list (systems have up to ~60 distinct forwarders).
- Rows with a blank `Vendor details` are ignored (not listed, not output).

### 3. People
- Unchanged from current tool: name rows, add/remove, Enter-to-add, names persisted
  to `localStorage`.

### 4. Split
- For each system: `rows = source rows where Vendor details is checked`, projected
  to exactly `[Vendor details, Supplier, Document number]` in that order.
- Feed into the **existing** split engine: optional skip-blank + shuffle, then
  `balancedSizes` per-sheet slicing across people.
- Each person → one workbook, one sheet per system (named by filename base), 3-column
  header + their slice. Per-file download links + "Download all as ZIP" — both
  already exist and are reused as-is.

## Implementation notes

Change is contained to `File_splitter.html`.

**State:** replace `workbook` / `sheetData` with
```
systems = [{ name, header:['Vendor details','Supplier','Document number'],
             rows:[[v,s,d], …],
             forwarders:[{ name, count, checked }] }]
```

**Functions:**
- `handleFile` → accept multiple files; per file build a `system` entry (locate
  columns, project rows, tally distinct forwarders) and render its forwarder picker.
- `splitFile` → iterate `systems` instead of `workbook.SheetNames`; each system's
  `dataRows` = rows whose `Vendor details` is currently checked.
- Update header/subtitle copy and the upload card (multi-file input + per-system
  list with pickers).

**Reused untouched:** `balancedSizes`, `shuffleArray`, `isBlankRow`, the per-sheet
slice loop, progress bar, `renderResults`, `downloadAll` (ZIP), the unique-filename
builder, and the entire theme/CSS.

## Deliberate simplifications

- **Consistent column order** `[Vendor details, Supplier, Document number]` for every
  system. `tarif.xlsx`'s OPP sheet used a different order (Vendor/Document/Supplier);
  treated as an incidental manual artifact. (User confirmed.)
- **Skip-blank / Shuffle toggles kept** as-is.

## Edge cases

- File missing a required column → badge + skip that system.
- No forwarders checked for a system → that system's sheet is empty (header only)
  for everyone; the existing "some sheets empty" warning already covers this.
- Blank `Vendor details` rows → dropped.
- Same base filename twice → `_2` suffix.

## Verification

Run the four real files (OPP/PS1/KSP/FNP) through the tool, pick a couple of
forwarders per system, split across 2–3 people, and confirm:
- each person's workbook has one sheet per system, exactly the 3 columns;
- per-system row counts across all people sum to the filtered totals (sum of counts
  of the checked forwarders);
- a system with a missing column is flagged and excluded.
