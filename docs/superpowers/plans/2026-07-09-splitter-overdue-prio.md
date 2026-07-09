# File Splitter — Date-Based PRIO Marking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rows whose `Overdue in workflow from` date is past or within 5 days get the yellow `PRIO` mark in the split output, merged with the existing PRIO-list mechanism.

**Architecture:** `File_splitter.html` is a single-file browser app; its pure helpers are unit-tested in Node via a vm harness (`tests/harness/load-splitter.mjs`). The projected row shape gains a 6th element (the raw overdue cell value); two new pure helpers (`prioByDate`, `isPrio`) decide the mark; `splitFile`/`renderRecap` switch from `prio`-only checks to the merged rule.

**Tech Stack:** Vanilla JS in one HTML file, xlsx-js-style (SheetJS) in the browser, `node:test` + `node:vm` for unit tests.

**Spec:** `docs/superpowers/specs/2026-07-09-splitter-overdue-prio-design.md`

## Global Constraints

- Node 24: run tests as `node --test "tests/splitter.test.mjs"` (quote the path; bare `node --test tests/` fails on this Node).
- All changes to `File_splitter.html` go in the inline attribute-less `<script>` block (the one containing `fileSplitter.names`) — that is what the vm harness loads.
- PRIO rule (from spec): `diff = today − overdue` in whole days, PRIO when `diff ≥ -5`. Round to the **nearest** local calendar day, never truncate — SheetJS parses Excel dates seconds before midnight (7/13 reads back as 7/12 23:59:48).
- Projected row shape after this plan: `[vendor, supplier, reference, doc, notes[], overdue]` — overdue is the raw cell value (`Date` from `cellDates: true`, a string, or `''` when the column is absent).
- Output sheet columns are unchanged except the existing trailing `PRIO` column, which now also appears without a PRIO list when overdue dates exist.
- Commit after each task; never push.

---

### Task 1: `prioByDate` helper

**Files:**
- Modify: `File_splitter.html` (constants near line 319, helpers after `normDoc` near line 468)
- Test: `tests/splitter.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `prioByDate(overdue, today)` → boolean. `overdue`: `Date` | string | `''`; `today`: `Date` (always passed explicitly). Also `dayNum(d)` → integer local-calendar-day number (internal, but exposed on the vm sandbox like every top-level function).

- [ ] **Step 1: Write the failing tests**

Append to `tests/splitter.test.mjs`:

```js
test('prioByDate: PRIO when today − overdue ≥ −5 days, nearest-day rounding', () => {
  const today = new Date(2026, 6, 9, 10, 30); // 2026-07-09 local, mid-morning
  const d = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 6, day, hh, mm, ss);
  assert.equal(s.prioByDate(d(15), today), false); // diff −6 -> not yet
  assert.equal(s.prioByDate(d(14), today), true);  // diff −5 boundary -> PRIO
  assert.equal(s.prioByDate(d(9), today), true);   // diff 0, due today -> PRIO
  assert.equal(s.prioByDate(d(6), today), true);   // diff +3, already overdue -> PRIO
  // SheetJS quirk: serial date lands 23:59:48 the day before -> must count as next day
  assert.equal(s.prioByDate(d(12, 23, 59, 48), today), true);  // is really 7/13, diff −4
  assert.equal(s.prioByDate(d(14, 23, 59, 48), today), false); // is really 7/15, diff −6
  // non-dates never mark
  assert.equal(s.prioByDate('', today), false);
  assert.equal(s.prioByDate('garbage', today), false);
  assert.equal(s.prioByDate(undefined, today), false);
  // parseable string dates work
  assert.equal(s.prioByDate('2026-07-06T12:00:00', today), true); // diff +3
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "tests/splitter.test.mjs"`
Expected: the new test FAILS with `s.prioByDate is not a function`; all pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `File_splitter.html`, directly after the `PRIO_HEADERS` constant (line 319):

```js
  const OVERDUE_HEADER = 'Overdue in workflow from';
```

Directly after the `normDoc` function (line 468):

```js
  // Date-based PRIO: a row is PRIO when today − overdue ≥ −5 whole days —
  // already overdue, or going overdue within the next 5 days. Both sides
  // round to the NEAREST local calendar day: SheetJS parses Excel serial
  // dates seconds before midnight (7/13 reads back as 7/12 23:59:48), so
  // truncating time-of-day would lose a day.
  const PRIO_OVERDUE_MIN_DIFF = -5;
  function dayNum(d) {
    return Math.round((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  }
  function prioByDate(overdue, today) {
    const d = overdue instanceof Date ? overdue
      : (typeof overdue === 'string' && overdue.trim() ? new Date(overdue) : null);
    if (!d || isNaN(d)) return false;
    return dayNum(today) - dayNum(d) >= PRIO_OVERDUE_MIN_DIFF;
  }
```

(`OVERDUE_HEADER` is consumed in Task 2; defining it with its sibling constants now keeps the constants block in one place.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/splitter.test.mjs"`
Expected: ALL tests PASS.

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): prioByDate — overdue-date PRIO rule with nearest-day rounding"
```

---

### Task 2: carry the overdue value through extraction

**Files:**
- Modify: `File_splitter.html` (`extractRows` ~line 416, `workbookEntries` ~lines 517-544)
- Test: `tests/splitter.test.mjs` (update the existing `extractRows` test, add one `workbookEntries` test)

**Interfaces:**
- Consumes: `OVERDUE_HEADER` from Task 1.
- Produces: `extractRows(dataRows, cols, noteIdx = [], overdueIdx = -1)` → rows shaped `[vendor, supplier, ref, doc, notes[], overdue]` where `overdue` is `r[overdueIdx]` or `''` when `overdueIdx < 0` / cell empty. `workbookEntries` locates the optional `Overdue in workflow from` header per sheet and passes its index through.

- [ ] **Step 1: Update/write the failing tests**

In `tests/splitter.test.mjs`, REPLACE the existing `extractRows` test (the one titled `extractRows: projects to [vendor,supplier,ref,doc,notes[]], collects Note cells, drops blank-vendor rows`) with:

```js
test('extractRows: projects to [vendor,supplier,ref,doc,notes[],overdue], collects Note cells, drops blank-vendor rows', () => {
  const due = new Date(2026, 6, 13);
  const rows = [
    // vendor,    supplier, ref, doc,  note@4,   note@5,           overdue@6
    ['DHL',      '111', 'R1', 'D1', '',      'kreditor fehlt', due],
    ['',         '222', 'R2', 'D2', 'x',     '',               ''], // blank vendor -> dropped
    ['Schenker', '444', 'R4', 'D4', 'noteA', 'noteB',          ''], // two note cells -> both kept, separate
    ['Kuehne',   '555', 'R5', 'D5', '',      '',               ''], // no note -> []
  ];
  assert.deepEqual(plain(s.extractRows(rows, [0, 1, 2, 3], [4, 5], 6)), plain([
    ['DHL', '111', 'R1', 'D1', ['kreditor fehlt'], due],
    ['Schenker', '444', 'R4', 'D4', ['noteA', 'noteB'], ''],
    ['Kuehne', '555', 'R5', 'D5', [], ''],
  ]));
  // no overdue column (default arg) -> index 5 is ''
  assert.deepEqual(plain(s.extractRows([['V', 'S', 'R', 'D', 'n']], [0, 1, 2, 3], [4])),
    [['V', 'S', 'R', 'D', ['n'], '']]);
});
```

Append a new test:

```js
test('workbookEntries: picks up the optional Overdue in workflow from column', () => {
  const H = ['Vendor details', 'Supplier', 'Reference', 'Document number', 'Overdue in workflow from'];
  const due = new Date(2026, 6, 13);
  const res = s.workbookEntries([{ name: 'S1', rows: [H, ['DHL', 'S', 'R', 'D1', due]] }], 'FNP.xlsx');
  assert.deepEqual(plain(res.entries[0].rows), plain([['DHL', 'S', 'R', 'D1', [], due]]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "tests/splitter.test.mjs"`
Expected: both tests FAIL (rows have no index-5 element yet).

- [ ] **Step 3: Implement**

In `File_splitter.html`, replace `extractRows` (and update its doc comment):

```js
  // Project rows to [Vendor details, Supplier, Reference, Document number,
  // notes[], overdue]; drop blank-vendor rows. notes collects the non-blank
  // Note cells individually — used only for the note filter, never written to
  // the output. overdue is the raw 'Overdue in workflow from' cell ('' when
  // the column is absent) — drives the date-based PRIO mark.
  function extractRows(dataRows, cols, noteIdx = [], overdueIdx = -1) {
    const [vi, si, ri, di] = cols;
    const out = [];
    for (const r of dataRows) {
      const v = r[vi];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      const notes = noteIdx.map(i => String(r[i] ?? '').trim()).filter(Boolean);
      out.push([r[vi], r[si], r[ri], r[di], notes, overdueIdx < 0 ? '' : (r[overdueIdx] ?? '')]);
    }
    return out;
  }
```

In `workbookEntries`, extend the `matched.push(...)` line to also locate the overdue column:

```js
      if (cols) matched.push({ base: String(sh.name).trim(), header, cols, noteIdx: noteColumns(header),
        overdueIdx: header.findIndex(h => String(h).trim() === OVERDUE_HEADER), dataRows: sh.rows.slice(hIdx + 1) });
```

And pass it through at the `extractRows` call site inside the same function:

```js
        const extracted = extractRows(parts[group], m.cols, m.noteIdx, m.overdueIdx);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/splitter.test.mjs"`
Expected: ALL tests PASS (the untouched `splitRows`/`tallyNotes`/sort tests only read indices 0-4 and are unaffected).

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): carry Overdue in workflow from through row extraction"
```

---

### Task 3: merged `isPrio` mark in output and recap

**Files:**
- Modify: `File_splitter.html` (helpers after `prioByDate`; `renderRecap` ~lines 614-637; `splitFile` ~lines 930-980)
- Test: `tests/splitter.test.mjs`

**Interfaces:**
- Consumes: `prioByDate` (Task 1), row index 5 (Task 2), existing `normDoc`, module-level `prio`.
- Produces: `isPrio(row, docs, today)` → boolean (`docs`: `Set<string>` | null — pass `prio && prio.docs`); `prioColumnOn(valid)` → boolean (module-level `prio` OR any valid system row carrying an overdue value).

- [ ] **Step 1: Write the failing test**

Append to `tests/splitter.test.mjs`:

```js
test('isPrio: PRIO-list doc match OR overdue date within window', () => {
  const today = new Date(2026, 6, 9);
  const row = (doc, overdue) => ['V', 'S', 'R', doc, [], overdue];
  const docs = new Set(['D1']);
  assert.equal(s.isPrio(row('D1', ''), docs, today), true);                        // list match alone
  assert.equal(s.isPrio(row('D2', ''), docs, today), false);                       // neither trigger
  assert.equal(s.isPrio(row('D2', new Date(2026, 6, 6)), docs, today), true);      // date rule alone (+3 overdue)
  assert.equal(s.isPrio(row('D2', new Date(2026, 6, 13)), null, today), true);     // no list, diff −4 -> PRIO
  assert.equal(s.isPrio(row('D2', new Date(2026, 6, 20)), null, today), false);    // no list, diff −11 -> no
  assert.equal(s.isPrio(row(' D1 ', ''), docs, today), true);                      // doc normalized via normDoc
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/splitter.test.mjs"`
Expected: FAILS with `s.isPrio is not a function`.

- [ ] **Step 3: Implement helpers**

In `File_splitter.html`, directly after `prioByDate`:

```js
  // A row gets the PRIO mark if it's on the PRIO list (docs, may be null) or
  // its overdue date is within the window.
  function isPrio(row, docs, today) {
    return !!(docs && docs.has(normDoc(row[3]))) || prioByDate(row[5], today);
  }
  // The PRIO output column exists when a PRIO list is loaded or any valid
  // system carries at least one overdue value.
  function prioColumnOn(valid) {
    return !!prio || valid.some(s => s.rows.some(r => r[5]));
  }
```

- [ ] **Step 4: Wire into `splitFile`**

In `splitFile`, after the `dateStr` line (`const dateStr = ...`, ~line 933), add:

```js
      const prioOn = prioColumnOn(valid);
```

Then replace the header/cells block inside the per-system loop (currently the `// With a PRIO list loaded...` comment plus the `header`/`cells` declarations, ~lines 967-972) with:

```js
            // With a PRIO list loaded or overdue dates present, the sheet
            // gains a trailing column: 'PRIO' on matching rows, yellow fill
            // on the doc + PRIO cells.
            const header = prioOn ? [...TARGET_COLS, 'PRIO'] : TARGET_COLS;
            const cells = chunk.map(r => prioOn
              ? [...r.slice(0, 4), isPrio(r, prio && prio.docs, today) ? 'PRIO' : '']
              : r.slice(0, 4));
```

(The styling line below it — `C >= 3 && cells[R - 1][4] === 'PRIO' ? PRIO_STYLE : DATA_STYLE` — already keys on the output cell at index 4 and needs no change. `today` already exists in `splitFile`.)

- [ ] **Step 5: Wire into `renderRecap`**

Replace the PRIO accounting in `renderRecap` (~lines 614-636). After the `shuffle` declaration add:

```js
    const prioOn = prioColumnOn(valid);
    const today = new Date();
```

Change the per-system hit counting line from `if (prio) for (const r of rows) if (prio.docs.has(normDoc(r[3]))) prioHits++;` to:

```js
        if (prioOn) for (const r of rows) if (isPrio(r, prio && prio.docs, today)) prioHits++;
```

Change the chip line from `if (prio) chips.push(\`PRIO list · ...\`)` to:

```js
    if (prioOn) chips.push(`PRIO · ${prioHits} match${prioHits === 1 ? '' : 'es'}`);
```

- [ ] **Step 6: Run the full suite**

Run: `node --test "tests/splitter.test.mjs"`
Expected: ALL tests PASS.

- [ ] **Step 7: End-to-end sanity check against the real example file**

Verify against `D:/Book1.xlsx` (SheetJS loaded in a vm, mirroring the browser): extract via `workbookEntries` and count `isPrio` hits — all 15 data rows must be PRIO (overdue 7/13, diff −4). Write this as a throwaway script in the scratchpad (NOT committed), pattern:

```js
// scratchpad/verify-book1.mjs — throwaway; needs scratchpad/xlsx.min.js
// (curl -sL -o xlsx.min.js https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadSplitter } from 'D:/vb-code-vault/tests/harness/load-splitter.mjs';

const sandbox = { console };
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('./xlsx.min.js', import.meta.url), 'utf8'), sandbox);
const XLSX = sandbox.XLSX;

const s = loadSplitter();
const wb = XLSX.read(readFileSync('D:/Book1.xlsx'), { type: 'buffer', cellDates: true });
const sheets = wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }) }));
const res = s.workbookEntries(sheets, 'Book1.xlsx');
const today = new Date();
for (const e of res.entries) {
  const hits = e.rows.filter(r => s.isPrio(r, null, today)).length;
  console.log(`${e.base}/${e.group}: ${hits}/${e.rows.length} PRIO`);
}
```

Expected output: one entry line with `15/15 PRIO`.

- [ ] **Step 8: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): mark PRIO from overdue dates, merged with PRIO-list mark"
```
