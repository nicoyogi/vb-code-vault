# File Splitter Note-Filter Checklist + Full-Width Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Note-filter textarea in `File_splitter.html` with a checklist of distinct note values (forwarder-picker pattern), and make the page full-width instead of a centered 620-px column.

**Architecture:** Single-file tool — all changes live in `File_splitter.html` (inline CSS + inline `<script>`), pure helpers unit-tested via the existing `node:vm` harness. Rows carry a notes **array** (was: merged string); a global `noteChecked` Map holds checklist state; matching is exact-value any-match. Layout: the three cards move into a `<main class="cards">` responsive grid; results become a tiled grid.

**Tech Stack:** Vanilla JS/HTML/CSS, SheetJS + JSZip from CDN (unchanged), `node --test` with `tests/harness/load-splitter.mjs` (unchanged).

**Spec:** `docs/superpowers/specs/2026-07-02-splitter-note-checklist-design.md`
**Branch:** `feat/splitter-note-checklist` (already created, spec committed)

## Global Constraints

- No new dependencies, no new files except this plan. The tool stays one HTML file.
- **Blank-note rows are always kept** — invariant, never weaken it.
- Note strings are **verbatim** — no casing/spelling normalization, exact-value matching.
- Notes are **never written to the output** — output sheets stay exactly `[Vendor details, Supplier, Document number]` via `r.slice(0, 3)`.
- Reuse the existing `fwd-search` / `fwd-mini` / `fwd-list` / `fwd-row` / `fwd-nm` / `fwd-ct` CSS classes for the note checklist — do not duplicate them.
- Default = **all notes checked** (equivalent to the old "empty box keeps everything").
- The note filter is **global** across all valid systems (as today).
- Tests run with: `node --test "tests/*.test.mjs"` from the repo root. All existing non-note tests must keep passing untouched.

---

### Task 1: Note checklist — pure helpers + UI rewiring

One task because the helpers and their only consumers (card 03 UI, stat line, split filter) must change together — splitting them would leave a commit where the page throws at runtime.

**Files:**
- Modify: `File_splitter.html` (card-03 HTML ~lines 179–184; script: state ~line 198, textarea listener ~line 214, `extractRows` ~264, `parseNoteTerms`/`noteKeep` ~285–296, `handleFile` tail ~323, `removeSystem` ~331, `updateNoteStat` ~337, after `renderSystems` ~413, `splitFile` ~502–507; CSS `.note-input` ~86–88)
- Test: `tests/splitter.test.mjs`

**Interfaces:**
- Consumes: existing `tallyForwarders(rows)`, `escapeHtml(s)`, `systems` array, `renderSystems()`, split engine — all unchanged.
- Produces (used by Task 3 verification and future work):
  - `extractRows(dataRows, cols, noteIdx)` → rows of `[vendor, supplier, doc, notes]` where `notes: string[]` (non-blank trimmed Note cells, **not** merged).
  - `tallyNotes(rows)` → `[{ name: string, count: number }]`, count-descending, counting every element of every row's `r[3]`.
  - `noteKeep(notes: string[], checked: Set<string>)` → `boolean` (empty array → `true`; else `notes.some(n => checked.has(n))`).
  - `noteChecked: Map<string, boolean>` (global), `checkedNoteSet(): Set<string>`, `rebuildNoteFilter()`, `renderNoteFilter(tally)`.
  - `parseNoteTerms` is **deleted**.

- [ ] **Step 1: Rewrite the note tests (failing first)**

In `tests/splitter.test.mjs`:

Replace the `extractRows` test (lines 18–31) with:

```js
test('extractRows: projects to [vendor,supplier,doc,notes[]], collects Note cells, drops blank-vendor rows', () => {
  const rows = [
    // vendor,    supplier, doc,  note@3,   note@4
    ['DHL',      '111', 'D1', '',      'kreditor fehlt'],
    ['',         '222', 'D2', 'x',     ''],              // blank vendor -> dropped
    ['Schenker', '444', 'D4', 'noteA', 'noteB'],         // two note cells -> both kept, separate
    ['Kuehne',   '555', 'D5', '',      ''],              // no note -> []
  ];
  assert.deepEqual(plain(s.extractRows(rows, [0, 1, 2], [3, 4])), [
    ['DHL', '111', 'D1', ['kreditor fehlt']],
    ['Schenker', '444', 'D4', ['noteA', 'noteB']],
    ['Kuehne', '555', 'D5', []],
  ]);
});
```

Delete the `parseNoteTerms` test (lines 38–43) entirely.

Replace the `noteKeep` test (lines 45–51) with:

```js
test('noteKeep: no notes always kept; else any note value in the checked set', () => {
  const checked = new Set(['fehlende Kreditorenangabe', 'Kreditor fehlt']);
  assert.equal(s.noteKeep([], checked), true);                              // blank -> always kept
  assert.equal(s.noteKeep(['fehlende Kreditorenangabe'], checked), true);
  assert.equal(s.noteKeep(['Falschabrechnung Diesel'], checked), false);    // exact value, no substring
  assert.equal(s.noteKeep(['Falschabrechnung Diesel', 'Kreditor fehlt'], checked), true); // any-match
  assert.equal(s.noteKeep(['anything'], new Set()), false);                 // nothing checked -> noted rows drop
});
```

Add after the `tallyForwarders` test (after line 56):

```js
test('tallyNotes: counts each note value across all rows, sorted desc', () => {
  const rows = [
    ['DHL', '', '1', ['A', 'B']],
    ['DHL', '', '2', ['A']],
    ['SCH', '', '3', []],
  ];
  assert.deepEqual(plain(s.tallyNotes(rows)), [{ name: 'A', count: 2 }, { name: 'B', count: 1 }]);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL — `extractRows` (still merges into a string), `noteKeep` (contains-semantics signature), `tallyNotes` (`s.tallyNotes is not a function`). `pickColumns`, `noteColumns`, `tallyForwarders`, `balancedSizes`, `systemName` still pass.

- [ ] **Step 3: Change the pure helpers in `File_splitter.html`**

Replace `extractRows` (~lines 261–274) — comment and body:

```js
  // Project rows to [Vendor details, Supplier, Document number, notes[]]; drop
  // blank-vendor rows. notes collects the non-blank Note cells individually —
  // used only for the note filter, never written to the output.
  function extractRows(dataRows, cols, noteIdx = []) {
    const [vi, si, di] = cols;
    const out = [];
    for (const r of dataRows) {
      const v = r[vi];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      const notes = noteIdx.map(i => String(r[i] ?? '').trim()).filter(Boolean);
      out.push([r[vi], r[si], r[di], notes]);
    }
    return out;
  }
```

Replace the `parseNoteTerms` + `noteKeep` block (~lines 285–296) with:

```js
  // Count rows per distinct note value across projected rows, sorted desc.
  // Per-cell values (not the merged string): combinations of standard phrases
  // across the up-to-4 Note columns would otherwise explode the distinct count.
  function tallyNotes(rows) {
    const m = new Map();
    for (const r of rows) for (const n of r[3]) m.set(n, (m.get(n) || 0) + 1);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }
  // Keep a row by its notes: rows without a note always pass; otherwise at
  // least one of the row's note values must be in the checked set.
  function noteKeep(notes, checked) {
    if (!notes || notes.length === 0) return true;
    return notes.some(n => checked.has(n));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS, all tests green (the UI wiring isn't loaded by the harness beyond top-level declarations, so the page's temporarily-stale callers don't affect tests).

- [ ] **Step 5: Rewire the UI — state, card 03, render, stat, split**

All in `File_splitter.html`.

**5a — global state.** After `let generatedFiles = [];` (~line 200) add:

```js
  let noteChecked = new Map(); // note string -> boolean (global checklist state)
```

**5b — card 03 HTML.** Replace the card (~lines 179–184):

```html
<div class="card">
  <div class="card-title">03 — Note filter <span class="opt-tag">optional</span></div>
  <p class="note-hint">Tick the <strong>Note</strong> values to keep. Rows with no note are always kept. Applies to all systems.</p>
  <div id="noteFilterBody"><p class="note-hint" style="margin-bottom:0; opacity:.6;">Upload files to list their notes.</p></div>
  <div class="note-stat" id="noteStat"></div>
</div>
```

**5c — delete the textarea listener.** Remove the line (~214):

```js
  document.getElementById('noteQuery').addEventListener('input', updateNoteStat);
```

**5d — rebuild + render.** Insert after the closing brace of `renderSystems()` (~line 413):

```js
  // Rebuild the global note checklist from all valid systems. Checked state is
  // keyed by the note string so it survives adding/removing files; notes first
  // seen default to checked. Stale entries drop out.
  function rebuildNoteFilter() {
    const valid = systems.filter(s => !s.error);
    const tally = tallyNotes(valid.flatMap(s => s.rows));
    const next = new Map();
    for (const t of tally) next.set(t.name, noteChecked.has(t.name) ? noteChecked.get(t.name) : true);
    noteChecked = next;
    renderNoteFilter(tally);
  }

  function checkedNoteSet() {
    return new Set([...noteChecked].filter(([, on]) => on).map(([name]) => name));
  }

  function renderNoteFilter(tally) {
    const body = document.getElementById('noteFilterBody');
    body.innerHTML = '';
    if (tally.length === 0) {
      body.innerHTML = '<p class="note-hint" style="margin-bottom:0; opacity:.6;">Upload files to list their notes.</p>';
      return;
    }
    const tools = document.createElement('div');
    tools.className = 'fwd-tools';
    tools.style.marginTop = '0';
    tools.innerHTML = `
      <input class="fwd-search" type="text" placeholder="Filter notes…" />
      <button class="fwd-mini" data-act="all">Select all</button>
      <button class="fwd-mini" data-act="none">Clear</button>`;
    body.appendChild(tools);

    const list = document.createElement('div');
    list.className = 'fwd-list';
    tally.forEach(t => {
      const row = document.createElement('label');
      row.className = 'fwd-row';
      row.innerHTML = `<input type="checkbox" ${noteChecked.get(t.name) ? 'checked' : ''} /><span class="fwd-nm" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span><span class="fwd-ct">${t.count}</span>`;
      row.querySelector('input').addEventListener('change', e => { noteChecked.set(t.name, e.target.checked); updateNoteStat(); });
      list.appendChild(row);
    });
    body.appendChild(list);

    tools.querySelector('.fwd-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      list.querySelectorAll('.fwd-row').forEach((r, i) => {
        r.classList.toggle('hide', q && !tally[i].name.toLowerCase().includes(q));
      });
    });
    tools.querySelectorAll('.fwd-mini').forEach(btn => btn.addEventListener('click', () => {
      const val = btn.dataset.act === 'all';
      for (const k of noteChecked.keys()) noteChecked.set(k, val);
      list.querySelectorAll('.fwd-row input').forEach(cb => cb.checked = val);
      updateNoteStat();
    }));
  }
```

**5e — call sites.** In `handleFile` (~line 323) change:

```js
        systems.push(sys);
        renderSystems();
        updateNoteStat();
```

to:

```js
        systems.push(sys);
        renderSystems();
        rebuildNoteFilter();
        updateNoteStat();
```

In `removeSystem` (~line 331) change:

```js
  function removeSystem(id) {
    systems = systems.filter(s => s.id !== id);
    renderSystems();
    updateNoteStat();
  }
```

to:

```js
  function removeSystem(id) {
    systems = systems.filter(s => s.id !== id);
    renderSystems();
    rebuildNoteFilter();
    updateNoteStat();
  }
```

**5f — stat line.** Replace `updateNoteStat` (~lines 337–353):

```js
  // Live count for the note checklist, across all valid systems.
  function updateNoteStat() {
    const el = document.getElementById('noteStat');
    if (!el) return;
    const valid = systems.filter(s => !s.error);
    if (valid.length === 0) { el.textContent = ''; return; }
    const keep = checkedNoteSet();
    let noted = 0, matched = 0, blank = 0;
    for (const sys of valid) for (const r of sys.rows) {
      if (r[3].length === 0) { blank++; continue; }
      noted++;
      if (noteKeep(r[3], keep)) matched++;
    }
    el.textContent = keep.size === noteChecked.size
      ? `All notes kept — ${noted + blank} rows (${blank} without a note).`
      : `Matches ${matched} of ${noted} noted rows; ${blank} blank-note rows always kept.`;
  }
```

**5g — split filter.** In `splitFile` (~lines 499–507) change:

```js
    const noteTerms = parseNoteTerms(document.getElementById('noteQuery').value);
```

to:

```js
    const keepNotes = checkedNoteSet();
```

and change the row filter:

```js
      let dataRows = sys.rows.filter(r => checked.has(r[0]) && noteKeep(r[3], noteTerms));
```

to:

```js
      let dataRows = sys.rows.filter(r => checked.has(r[0]) && noteKeep(r[3], keepNotes));
```

**5h — dead CSS.** Delete the now-unused `.note-input` rules (~lines 86–88):

```css
  .note-input { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-family: var(--mono); font-size: 13px; color: var(--text); outline: none; resize: vertical; transition: border-color 0.15s; }
  .note-input:focus { border-color: var(--accent); }
  .note-input::placeholder { color: var(--text3); }
```

- [ ] **Step 6: Run tests + grep for stragglers**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS (all tests).

Run: `grep -n "parseNoteTerms\|noteQuery\|note-input" File_splitter.html tests/splitter.test.mjs`
Expected: no matches. If anything matches, remove it.

- [ ] **Step 7: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): Note filter is a checklist of distinct note values

Card 03 textarea -> forwarder-picker-style checklist (search, all/none,
counts). Rows carry per-cell notes[] instead of a merged string, so phrase
combinations across the 4 Note columns no longer explode the distinct
count. Exact-value any-match; blank-note rows always kept; all checked by
default = old no-filter behavior. parseNoteTerms deleted."
```

---

### Task 2: Full-width layout

CSS + two HTML wrapper lines. No unit tests (pure presentation); verified in Task 3.

**Files:**
- Modify: `File_splitter.html` (CSS rules ~lines 21–122; HTML: insert `<main class="cards">` after `</header>` ~line 139, `</main>` after card 03)

**Interfaces:**
- Consumes: existing markup/classes from Task 1 (card 03 uses `#noteFilterBody`).
- Produces: `main.cards` grid wrapper; `.results` is now a **grid** (`display: grid` when shown) with `.result-summary` spanning all columns. The grimoire hook `data-grim-cards=".card"` keeps matching (cards keep class `card`).

- [ ] **Step 1: Widen the page — CSS edits**

All edits in the `<style>` block of `File_splitter.html`. Current → new:

**1a — header** (~line 22):

```css
  header { width: 100%; max-width: 620px; margin-bottom: 48px; }
```
→
```css
  header { width: 100%; margin-bottom: 36px; }
```

**1b — cards + grid wrapper** (~line 27):

```css
  .card { width: 100%; max-width: 620px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; margin-bottom: 16px; }
```
→
```css
  .card { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; }
  main.cards { width: 100%; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 16px; align-items: start; margin-bottom: 16px; }
```

(`min(340px, 100%)` keeps single-column mobile from overflowing; `align-items: start` lets each card keep its natural height.)

**1c — nav-back pinned left** (~line 121). The body is `align-items: center`; with full-width blocks only the intrinsic-width `.nav-back` would float centered. Append `align-self: flex-start;`:

```css
  .nav-back { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text2); text-decoration: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; transition: color 0.15s, border-color 0.15s, background 0.15s; margin-bottom: 36px; align-self: flex-start; }
```

**1d — full-width action row + messages.** Remove `max-width: 620px` from each of these rules (~lines 91, 95, 116, 119), leaving the rest of each rule untouched:

- `.split-btn { width: 100%; max-width: 620px; …` → `.split-btn { width: 100%; …`
- `.progress-wrap { display: none; width: 100%; max-width: 620px; …` → `.progress-wrap { display: none; width: 100%; …`
- `.dl-all { width: 100%; max-width: 620px; …` → `.dl-all { width: 100%; …`
- `.error-msg { display: none; width: 100%; max-width: 620px; …` → `.error-msg { display: none; width: 100%; …`

**1e — results tile as a grid** (~lines 100–102):

```css
  .results { display: none; width: 100%; max-width: 620px; flex-direction: column; gap: 10px; margin-top: 8px; }
  .results.show { display: flex; }
```
→
```css
  .results { display: none; width: 100%; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 10px; margin-top: 8px; }
  .results.show { display: grid; }
```

And append `grid-column: 1 / -1;` to `.result-summary` (~line 102):

```css
  .result-summary { display: flex; flex-wrap: wrap; gap: 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 20px; font-size: 12px; color: var(--text2); font-family: var(--mono); letter-spacing: 0.02em; grid-column: 1 / -1; }
```

- [ ] **Step 2: Wrap the three cards in `<main>`**

After `</header>` (~line 139) insert `<main class="cards">`; after the closing `</div>` of card 03 (the Note-filter card) insert `</main>`. The split button, error, progress, results, dl-all stay direct body children:

```html
</header>

<main class="cards">
<div class="card">
  <div class="card-title">01 — Upload files (one per system)</div>
  …
</div>

<div class="card">
  <div class="card-title">02 — Add people</div>
  …
</div>

<div class="card">
  <div class="card-title">03 — Note filter <span class="opt-tag">optional</span></div>
  …
</div>
</main>

<button class="split-btn" id="splitBtn" onclick="splitFile()">⚡ Split file</button>
```

(`…` = existing card contents, unchanged — shown here only to mark the wrapper positions; do not alter card internals in this task.)

- [ ] **Step 3: Run tests (guard against accidental script damage)**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS.

Run: `grep -c "max-width: 620px" File_splitter.html`
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): full-width layout — cards in a responsive grid

Drop the centered 620px column: Upload | People | Note filter sit side by
side (auto-fit minmax(340px,1fr), stacking on narrow screens), results
tile as an auto-fill grid with the summary spanning all columns."
```

---

### Task 3: Browser verification

The tool is a static page — serve the repo root and drive the preview. File uploads can't be simulated through the file input, so seed `systems` directly via `preview_eval` (same row shape `handleFile` produces) to exercise rendering; the real four-file run stays a user step.

**Files:**
- Create: `.claude/launch.json` (only if it doesn't exist yet)

**Interfaces:**
- Consumes: `systems`, `renderSystems()`, `rebuildNoteFilter()`, `updateNoteStat()` from Task 1; layout from Task 2.
- Produces: screenshots as proof; no code.

- [ ] **Step 1: Serve the page**

If `.claude/launch.json` doesn't exist, create it:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "vault",
      "runtimeExecutable": "python",
      "runtimeArgs": ["-m", "http.server", "8123"],
      "port": 8123
    }
  ]
}
```

Start it with the preview_start tool (name `vault`), then navigate:
`preview_eval`: `window.location.href = '/File_splitter.html'`

- [ ] **Step 2: Empty state**

`preview_snapshot` — expect card 03 to show "Upload files to list their notes." and no checklist. `preview_console_logs` (level error) — expect none.

- [ ] **Step 3: Seed fake systems and check the checklist**

`preview_eval` (IIFE):

```js
(() => {
  systems.push(
    { id: 'sysA', name: 'OPP', fileName: 'OPP.xlsx', forwarders: [{ name: 'DHL', count: 2, checked: true }],
      rows: [['DHL', 's1', 'd1', ['fehlende Kreditorenangabe']],
             ['DHL', 's2', 'd2', []],
             ['DHL', 's3', 'd3', ['Falschabrechnung Diesel', 'fehlende Kreditorenangabe']]] },
    { id: 'sysB', name: 'KSP', fileName: 'KSP.xlsx', forwarders: [{ name: 'Schenker', count: 1, checked: true }],
      rows: [['Schenker', 's4', 'd4', ['fehlende Kreditorenangabe']]] });
  renderSystems(); rebuildNoteFilter(); updateNoteStat();
  return document.getElementById('noteStat').textContent;
})()
```

Expected return: `All notes kept — 4 rows (1 without a note).`
`preview_snapshot` — expect checklist rows `fehlende Kreditorenangabe — 3` then `Falschabrechnung Diesel — 1` (count-descending, counts summed across systems).

- [ ] **Step 4: Interaction — uncheck, stat updates**

`preview_click` the `Falschabrechnung Diesel` row's checkbox (selector from the snapshot; the rows are `#noteFilterBody .fwd-row input`, second one). Then `preview_eval`: `document.getElementById('noteStat').textContent`
Expected: `Matches 3 of 3 noted rows; 1 blank-note rows always kept.` (the Diesel row also carries a checked note — any-match keeps it).
Then click `Clear` (`#noteFilterBody .fwd-mini[data-act="none"]`) and re-read the stat.
Expected: `Matches 0 of 3 noted rows; 1 blank-note rows always kept.`

- [ ] **Step 5: Layout proof**

Desktop: `preview_resize` preset `desktop` → `preview_screenshot` — cards side by side, no centered gutter.
Mobile: `preview_resize` preset `mobile` → `preview_screenshot` — cards stacked, no horizontal overflow.
Reset to desktop afterwards.

- [ ] **Step 6: Commit launch.json (if created) and hand to the user**

```bash
git add .claude/launch.json
git commit -m "chore: launch config for static preview server"
```

Then ask the user to run the four real files (OPP/PS1/KSP/FNP) through the tool and confirm: checklist is phrase-catalog-sized (not ~609 entries), `Clear` + one phrase yields that phrase's count + blank rows, and each person's workbook still has one 3-column sheet per system.

---

## Execution notes

- Tasks run in order; Task 2 depends on Task 1's card-03 markup, Task 3 on both.
- Every commit on `feat/splitter-note-checklist`; PR to `main` after user confirmation (repo convention: PR-merge, see #177/#178).
