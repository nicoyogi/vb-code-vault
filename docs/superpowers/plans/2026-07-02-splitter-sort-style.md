# File Splitter Z-A Sort + Styled Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each person's output sheet is sorted by Document number Z→A (Shuffle keeps only its distribution role), and the generated workbooks get a styled header, borders, fitted column widths and an autofilter via the drop-in `xlsx-js-style` fork.

**Architecture:** All changes in `File_splitter.html` + `tests/splitter.test.mjs`. Two new pure top-level helpers (`docNumDesc`, `colWidths`) tested through the existing node:vm harness; the styling is applied inline in `splitFile` after `aoa_to_sheet`. The CDN `<script>` swaps to `xlsx-js-style@1.2.0` (same SheetJS 0.18.5 core and `XLSX` global; adds `cell.s` style writing).

**Tech Stack:** Vanilla JS, `xlsx-js-style@1.2.0` (jsdelivr CDN), JSZip unchanged, `node --test "tests/*.test.mjs"`.

**Spec:** `docs/superpowers/specs/2026-07-02-splitter-sort-style-design.md`
**Branch:** `feat/splitter-note-checklist` (append to open PR #180)

## Global Constraints

- No npm dependencies — the new library arrives only as the swapped CDN `<script src>`; the tool stays one HTML file.
- The `XLSX` global and every existing call (`XLSX.read`, `sheet_to_json`, `aoa_to_sheet`, `book_new`, `book_append_sheet`, `XLSX.write`) stay untouched — `xlsx-js-style` is API-compatible.
- **Sort applies always** (Shuffle on or off), per person per system, after slicing — the shared pool and slice boundaries are never re-ordered.
- Exact styling values from the spec: header `font { bold, color FFFFFF }` + `fill { fgColor 262626 }`; all borders `{ style: 'thin', color: { rgb: 'B0B0B0' } }` on all four sides; widths `clamp(maxLen + 2, 12, 44)`; autofilter over used range incl. header.
- Output stays exactly 3 columns via `r.slice(0, 3)` — notes never written.
- Tests run with `node --test "tests/*.test.mjs"`; all existing tests keep passing untouched.

---

### Task 1: Sort + styling — helpers, wiring, CDN swap

**Files:**
- Modify: `File_splitter.html` (CDN script tag ~line 8; toggle copy ~line 171; constants near `TARGET_COLS` ~line 202; new helpers after `systemName` ~line 284; `splitFile` chunk/sheet block ~lines 586–594)
- Test: `tests/splitter.test.mjs`

**Interfaces:**
- Consumes: projected row shape `[vendor, supplier, doc, notes[]]` (index 2 = Document number), `TARGET_COLS`, existing `splitFile` flow.
- Produces:
  - `docNumDesc(a, b)` → number; comparator over projected rows, descending by `String(x[2])`, numeric-aware, blanks last.
  - `colWidths(header, rows)` → `[{ wch: number }]` per column, `clamp(maxLen + 2, 12, 44)`.
  - Style constants `BORDER_THIN`, `CELL_BORDERS`, `HEADER_STYLE`, `DATA_STYLE` (top-level `const`).

- [ ] **Step 1: Write the failing tests**

In `tests/splitter.test.mjs`, add after the `tallyNotes` test:

```js
test('docNumDesc: sorts rows by Document number Z→A, numeric-aware, blanks last', () => {
  const r = d => ['V', 'S', d, []];
  const rows = [r('9'), r('D-2'), r(''), r('10'), r(100), r('D-10')];
  const sorted = [...rows].sort(s.docNumDesc).map(x => String(x[2]));
  assert.deepEqual(plain(sorted), ['D-10', 'D-2', '100', '10', '9', '']);
});

test('colWidths: per-column max content length +2, clamped to [12, 44]', () => {
  const header = ['Vendor details', 'Supplier', 'Document number'];
  const rows = [
    ['Schenker Deutschland AG, Nuernberg', '12345', 'D1'],
    ['DHL', 'x'.repeat(60), 4711],
  ];
  assert.deepEqual(plain(s.colWidths(header, rows)), [
    { wch: 36 }, // 34 + 2
    { wch: 44 }, // 62 capped
    { wch: 17 }, // header 'Document number' (15) + 2
  ]);
  assert.deepEqual(plain(s.colWidths(['A', 'B', 'C'], [])),
    [{ wch: 12 }, { wch: 12 }, { wch: 12 }]); // floor
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL — `s.docNumDesc is not a function`, `s.colWidths is not a function`. Everything else passes.

- [ ] **Step 3: Add the pure helpers**

In `File_splitter.html`, insert after the closing brace of `systemName` (the function ending `return fileName.replace(/\.[^.]+$/, '').trim() || 'Sheet';` + `}`):

```js
  // Sort projected rows by Document number (index 2), Z→A, numeric-aware
  // ("10" above "9"); blank/missing document numbers sink to the bottom.
  function docNumDesc(a, b) {
    return String(b[2] ?? '').localeCompare(String(a[2] ?? ''), undefined, { numeric: true, sensitivity: 'base' });
  }
  // Column widths for the output sheet: content-fitted, clamped to [12, 44].
  function colWidths(header, rows) {
    return header.map((h, c) => {
      let max = String(h).length;
      for (const r of rows) max = Math.max(max, String(r[c] ?? '').length);
      return { wch: Math.min(Math.max(max + 2, 12), 44) };
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, all tests.

- [ ] **Step 5: CDN swap, style constants, splitFile wiring, toggle copy**

**5a — CDN script tag.** Replace:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
```

with:

```html
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js"></script>
```

**5b — style constants.** After the line `const TARGET_COLS = ['Vendor details', 'Supplier', 'Document number'];` add:

```js
  const BORDER_THIN = { style: 'thin', color: { rgb: 'B0B0B0' } };
  const CELL_BORDERS = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
  const HEADER_STYLE = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '262626' } }, border: CELL_BORDERS };
  const DATA_STYLE = { border: CELL_BORDERS };
```

**5c — sort + styles in `splitFile`.** Replace:

```js
        const rows = pool[sys.name];
        const [start, end] = bounds[sys.name][i];
        const chunk = rows.slice(start, end);

        sheetSummary[sys.name] = chunk.length;

        const ws = XLSX.utils.aoa_to_sheet([TARGET_COLS, ...chunk.map(r => r.slice(0, 3))]);
        XLSX.utils.book_append_sheet(wb, ws, sys.name);
```

with:

```js
        const rows = pool[sys.name];
        const [start, end] = bounds[sys.name][i];
        const chunk = rows.slice(start, end);
        chunk.sort(docNumDesc); // Z→A per sheet; the shared pool stays untouched

        sheetSummary[sys.name] = chunk.length;

        const ws = XLSX.utils.aoa_to_sheet([TARGET_COLS, ...chunk.map(r => r.slice(0, 3))]);
        for (let R = 0; R <= chunk.length; R++) for (let C = 0; C < TARGET_COLS.length; C++) {
          const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          if (cell) cell.s = R === 0 ? HEADER_STYLE : DATA_STYLE;
        }
        ws['!cols'] = colWidths(TARGET_COLS, chunk);
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: chunk.length, c: TARGET_COLS.length - 1 } }) };
        XLSX.utils.book_append_sheet(wb, ws, sys.name);
```

**5d — toggle copy.** Replace:

```html
    <div class="toggle-label"><span>Shuffle rows</span> — randomly mix data so everyone gets a spread, not just top/middle/bottom</div>
```

with:

```html
    <div class="toggle-label"><span>Shuffle rows</span> — randomly mix who gets which rows; every sheet is re-sorted by Document number (Z→A) after splitting</div>
```

- [ ] **Step 6: Full suite + stragglers check**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS (all tests).

Run: `grep -c "cdnjs.cloudflare.com/ajax/libs/xlsx" File_splitter.html`
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): Z-A document order + styled workbook output

Each person's sheet is sorted by Document number descending after
slicing — Shuffle now only decides who gets which rows. CDN swaps to
xlsx-js-style (same SheetJS 0.18.5 API) so sheets get a bold dark
header, thin borders, fitted column widths and an autofilter."
```

---

### Task 2: Browser verification (controller-run)

Round-trip the generated workbook in the live page.

**Interfaces:**
- Consumes: Task 1's wiring; seeded `systems` + one person name; `splitFile()`, `generatedFiles`.

- [ ] **Step 1: Reload the preview page** (`window.location.reload()`), confirm no console errors and the page loads `xlsx-js-style` (`typeof XLSX.version` defined).

- [ ] **Step 2: Seed + split.** Via eval: seed one system with unsorted document numbers (e.g. `d1`, `d10`, `d2`, one blank), set a person name, run `await splitFile()`.

- [ ] **Step 3: Round-trip assert.** Read `generatedFiles[0].blob` as ArrayBuffer, `XLSX.read(..., { cellStyles: true })`, then assert:
- `sheet_to_json(ws, { header: 1 })` data rows are Z→A by Document number (blank last);
- `ws['!cols']` exists with `wch >= 12`;
- `ws['!autofilter'].ref` covers the used range;
- header cell `A1` has `.s.font.bold === true` (if the fork doesn't surface styles on read, note it and rely on the user's Excel check).

- [ ] **Step 4: Report** results + screenshots if useful; remind the user to open a real output in Excel (styling is ultimately visual).
