# File Splitter — Tariff vs Factual Branching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify each uploaded system file as Tariff or Factual from its `Step description` column; Tariff keeps forwarder + note filters, Factual bypasses both, and each type has its own people list and its own output files (`Name_Tariff_date.xlsx` / `Name_Factual_date.xlsx`).

**Architecture:** Single-file browser app — all logic lives in the inline `<script>` of `File_splitter.html`. A `group` field (`'tariff' | 'factual'`) is added to each system object at upload via a new pure helper `detectGroup`; a second pure helper `splitRows` centralizes the per-group row filtering. The split loop becomes one "job" per group in use.

**Tech Stack:** Vanilla JS in HTML, xlsx-js-style (CDN), node:test + node:vm harness (`tests/harness/load-splitter.mjs`).

**Spec:** `docs/superpowers/specs/2026-07-03-splitter-tariff-factual-design.md`

## Global Constraints

- All app changes go in `File_splitter.html`; tests in `tests/splitter.test.mjs`. No new dependencies.
- The literal string `fileSplitter.names` MUST remain in the inline script — `tests/harness/load-splitter.mjs` uses it as the sentinel to find the script block.
- New helpers must be top-level `function` declarations (the vm harness relies on hoisting; arrow consts assigned after a top-level throw would be undefined).
- Test command (Node 24 — glob must be quoted): `node --test "tests/*.test.mjs"`
- Keywords, case-insensitive substring: `tarif` → tariff (covers "Tariff", "Tarifprüfung"); `factual` or `faktual` → factual. Column missing / no match ⇒ `tariff`.
- localStorage keys: tariff = `fileSplitter.names` (existing), factual = `fileSplitter.namesFactual`.
- Output filenames: `{safeName}_{Tariff|Factual}_{dd.mm.yyyy}.xlsx` (the `_data_` token is replaced by the group label).
- Work from the repo root `D:\vb-code-vault`, branch `feat/splitter-tariff-factual` (already created; spec committed).

---

### Task 1: `detectGroup` helper (TDD)

**Files:**
- Modify: `File_splitter.html` (inline script, after `prioDocsFromSheet`, ~line 456)
- Test: `tests/splitter.test.mjs`

**Interfaces:**
- Produces: `detectGroup(header: any[], dataRows: any[][]) => 'tariff' | 'factual'` — used by Task 3 in `handleFile`.

- [ ] **Step 1: Write the failing test** — append to `tests/splitter.test.mjs`:

```js
test('detectGroup: first matching Step description cell decides; default tariff', () => {
  const H = ['Vendor details', 'Step description', 'Document number'];
  assert.equal(s.detectGroup(H, [['DHL', 'Tariff check', 'D1']]), 'tariff');
  assert.equal(s.detectGroup(H, [['DHL', 'Factual check', 'D1']]), 'factual');
  assert.equal(s.detectGroup(H, [['DHL', 'Faktuale Prüfung', 'D1']]), 'factual');   // German spelling
  assert.equal(s.detectGroup(H, [['DHL', 'TARIFPRÜFUNG', 'D1']]), 'tariff');        // case + single f
  assert.equal(s.detectGroup(H, [['DHL', '', 'D1'], ['X', 'step Factual', 'D2']]), 'factual'); // skips non-matching cells
  assert.equal(s.detectGroup(H, [['DHL', 'other step', 'D1']]), 'tariff');          // no match -> tariff
  assert.equal(s.detectGroup(['Vendor details'], [['DHL']]), 'tariff');             // column missing -> tariff
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL — `s.detectGroup is not a function`

- [ ] **Step 3: Write minimal implementation** — in `File_splitter.html`, insert after the closing `}` of `prioDocsFromSheet` (before the `// ---- wizard ----` comment):

```js
  // Classify a file as tariff or factual work from its 'Step description'
  // column: the first cell containing a keyword decides. Missing column or
  // no matching cell -> 'tariff' (the pre-branching behavior).
  function detectGroup(header, dataRows) {
    const si = header.findIndex(h => String(h).trim() === 'Step description');
    if (si < 0) return 'tariff';
    for (const r of dataRows) {
      const v = String(r[si] ?? '').toLowerCase();
      if (v.includes('tarif')) return 'tariff';
      if (v.includes('factual') || v.includes('faktual')) return 'factual';
    }
    return 'tariff';
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/*.test.mjs"`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): detectGroup classifies a file tariff/factual from Step description"
```

---

### Task 2: `splitRows` helper (TDD) + wire into existing filter sites

**Files:**
- Modify: `File_splitter.html` (helper after `detectGroup`; call sites in `renderRecap` and `splitFile`)
- Test: `tests/splitter.test.mjs`

**Interfaces:**
- Consumes: `noteKeep`, `isBlankRow` (existing).
- Produces: `splitRows(sys: {group?, rows, forwarders}, keepNotes: Set<string>, skipBlanks: boolean) => rows[]` — Task 5's split loop and `renderRecap` rely on it. `sys.group === undefined` behaves as tariff, so wiring it in now is a pure refactor (no system has a group yet).

- [ ] **Step 1: Write the failing test** — append to `tests/splitter.test.mjs`:

```js
test('splitRows: tariff rows pass forwarder+note filters; factual rows bypass both', () => {
  const rows = [
    ['DHL', 'S', 'R', 'D1', []],
    ['Kuehne', 'S', 'R', 'D2', ['bad note']],
  ];
  const fwd = [{ name: 'DHL', checked: true }, { name: 'Kuehne', checked: false }];
  const keep = new Set(); // no notes checked
  assert.deepEqual(plain(s.splitRows({ group: 'tariff', rows, forwarders: fwd }, keep, true)),
    [['DHL', 'S', 'R', 'D1', []]]);            // Kuehne: unchecked forwarder AND unchecked note
  assert.deepEqual(plain(s.splitRows({ rows, forwarders: fwd }, keep, true)),
    [['DHL', 'S', 'R', 'D1', []]]);            // no group -> tariff behavior
  assert.deepEqual(plain(s.splitRows({ group: 'factual', rows, forwarders: fwd }, keep, true)),
    plain(rows));                              // factual ignores forwarders and notes
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL — `s.splitRows is not a function`

- [ ] **Step 3: Implement + replace both duplicated filter sites**

3a. Insert after the closing `}` of `detectGroup`:

```js
  // Rows a system contributes to the split: tariff rows pass the forwarder
  // checklist + note filter; factual rows skip both. Blank-skip applies to all.
  function splitRows(sys, keepNotes, skipBlanks) {
    let rows = sys.rows;
    if (sys.group !== 'factual') {
      const checked = new Set(sys.forwarders.filter(f => f.checked).map(f => f.name));
      rows = rows.filter(r => checked.has(r[0]) && noteKeep(r[4], keepNotes));
    }
    return skipBlanks ? rows.filter(r => !isBlankRow(r)) : rows;
  }
```

3b. In `renderRecap`, replace:

```js
    let planned = 0, prioHits = 0;
    for (const sys of valid) {
      const checked = new Set(sys.forwarders.filter(f => f.checked).map(f => f.name));
      let rows = sys.rows.filter(r => checked.has(r[0]) && noteKeep(r[4], keep));
      if (skipBlanks) rows = rows.filter(r => !isBlankRow(r));
      planned += rows.length;
```

with:

```js
    let planned = 0, prioHits = 0;
    for (const sys of valid) {
      const rows = splitRows(sys, keep, skipBlanks);
      planned += rows.length;
```

3c. In `splitFile`, replace:

```js
      for (const sys of valid) {
        const checked = new Set(sys.forwarders.filter(f => f.checked).map(f => f.name));
        let dataRows = sys.rows.filter(r => checked.has(r[0]) && noteKeep(r[4], keepNotes));
        if (skipBlanks) dataRows = dataRows.filter(r => !isBlankRow(r));
        const rows = doShuffle ? shuffleArray(dataRows) : dataRows;
```

with:

```js
      for (const sys of valid) {
        const dataRows = splitRows(sys, keepNotes, skipBlanks);
        const rows = doShuffle ? shuffleArray(dataRows) : dataRows;
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test "tests/*.test.mjs"`
Expected: all tests PASS (existing tests prove the refactor didn't change behavior)

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "refactor(splitter): extract splitRows — per-group filter policy in one place"
```

---

### Task 3: Wire group into upload, cards, and note filter

**Files:**
- Modify: `File_splitter.html` — CSS block, step-1/step-3 copy, `handleFile`, `renderSystems`, `rebuildNoteFilter`, `updateNoteStat`

**Interfaces:**
- Consumes: `detectGroup` (Task 1).
- Produces: `sys.group` set on every loaded system — Tasks 4–5 read it.

- [ ] **Step 1: Set `group` in `handleFile`** — replace:

```js
        const sys = { id: 'sys' + (sysSeq++), name, fileName: file.name, rows: [], forwarders: [] };
```

with:

```js
        const sys = { id: 'sys' + (sysSeq++), name, fileName: file.name, rows: [], forwarders: [], group: detectGroup(header, rows.slice(hIdx + 1)) };
```

- [ ] **Step 2: Add badge CSS** — in the `<style>` block, insert after the `.prio-label strong { ... }` rule:

```css
  .type-badge { font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em; padding: 3px 7px; border-radius: 5px; white-space: nowrap; flex-shrink: 0; }
  .type-badge.tariff { color: var(--accent); background: var(--accent-dim); border: 1px solid var(--accent-mid); }
  .type-badge.factual { color: var(--warn); background: rgba(245,166,35,0.12); border: 1px solid rgba(245,166,35,0.4); }
```

- [ ] **Step 3: Badge + conditional forwarder UI in `renderSystems`**

3a. Replace:

```js
      const meta = sys.error ? '' : `<span class="system-meta">${sys.rows.length} rows · ${sys.forwarders.length} forwarders</span>`;
      card.innerHTML = `
        <div class="system-head">
          <span class="system-badge">${escapeHtml(sys.name)}</span>
          <span class="system-name">${escapeHtml(sys.fileName)}</span>
```

with:

```js
      const meta = sys.error ? '' : `<span class="system-meta">${sys.rows.length} rows${sys.group === 'factual' ? '' : ` · ${sys.forwarders.length} forwarders`}</span>`;
      card.innerHTML = `
        <div class="system-head">
          <span class="system-badge">${escapeHtml(sys.name)}</span>
          <span class="type-badge ${sys.group === 'factual' ? 'factual' : 'tariff'}">${sys.group === 'factual' ? 'FACTUAL' : 'TARIFF'}</span>
          <span class="system-name">${escapeHtml(sys.fileName)}</span>
```

3b. Wrap the entire forwarder tools + list construction (from `const tools = document.createElement('div');` down to the `tools.querySelectorAll('.fwd-mini').forEach(...)` block, inclusive) in:

```js
      if (sys.group !== 'factual') {
        // ...existing tools + list code, unchanged...
      }
      el.appendChild(card);
```

(`el.appendChild(card);` stays outside the `if`, as the last line of the forEach.)

- [ ] **Step 4: Note filter = tariff only**

4a. In `rebuildNoteFilter`, replace `const valid = systems.filter(s => !s.error);` with:

```js
    const valid = systems.filter(s => !s.error && s.group !== 'factual');
```

4b. In `updateNoteStat`, replace `const valid = systems.filter(s => !s.error);` with:

```js
    const valid = systems.filter(s => !s.error && s.group !== 'factual');
```

- [ ] **Step 5: Copy updates**

5a. Step-1 card-desc — replace:

```html
  <p class="card-desc">One Excel file per system. We read the <strong>Vendor details</strong>, <strong>Supplier</strong>, <strong>Reference</strong> and <strong>Document number</strong> columns.</p>
```

with:

```html
  <p class="card-desc">One Excel file per system. We read the <strong>Vendor details</strong>, <strong>Supplier</strong>, <strong>Reference</strong> and <strong>Document number</strong> columns. The <strong>Step description</strong> column decides Tariff vs Factual work.</p>
```

5b. Step-3 card-desc — replace:

```html
  <p class="card-desc">Tick the <strong>Note</strong> values to keep. Rows with no note are always kept. Applies to all systems.</p>
```

with:

```html
  <p class="card-desc">Tick the <strong>Note</strong> values to keep. Rows with no note are always kept. Applies to <strong>Tariff</strong> systems only — Factual rows are never filtered.</p>
```

- [ ] **Step 6: Run tests (regression)**

Run: `node --test "tests/*.test.mjs"`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): classify files tariff/factual — card badges, factual skips forwarder+note filters"
```

---

### Task 4: Two people lists (Tariff / Factual)

**Files:**
- Modify: `File_splitter.html` — step-2 HTML, CSS, people JS (`addPerson`, `removePerson`, `getNames`, `saveNames`, restore IIFE, listeners), `stepUnlocked`, `renderWizard`

**Interfaces:**
- Consumes: `sys.group` (Task 3).
- Produces: `GROUPS` constant `[['tariff','Tariff'],['factual','Factual']]`; `getNames(group) => string[]`; `addPerson(group, value?)`. Task 5's `splitFile`/`renderRecap` call `getNames(group)` and iterate `GROUPS`.

- [ ] **Step 1: Replace step-2 card HTML** — replace the whole step-2 card:

```html
<div class="card step-card" hidden>
  <div class="card-head"><h2>Who gets a share?</h2><span class="step-tag">step 2 of 4</span></div>
  <p class="card-desc">Rows are shared out as evenly as possible — one Excel file per person.</p>
  <div class="people-list" id="peopleList">
    <div class="person-row">
      <span class="person-num">1</span>
      <input class="person-input" type="text" placeholder="Enter name…" />
      <button class="rm-btn" onclick="removePerson(this)">×</button>
    </div>
  </div>
  <button class="add-btn" onclick="addPerson()">+ Add person</button>
```

with:

```html
<div class="card step-card" id="peopleCard" hidden>
  <div class="card-head"><h2>Who gets a share?</h2><span class="step-tag">step 2 of 4</span></div>
  <p class="card-desc">Rows are shared out as evenly as possible — one Excel file per person, per work type.</p>
  <div class="people-group" id="groupTariff">
    <div class="group-head"><span class="type-badge tariff">TARIFF</span><span class="group-note">forwarder + note filters apply</span></div>
    <div class="people-list" data-group="tariff">
      <div class="person-row">
        <span class="person-num">1</span>
        <input class="person-input" type="text" placeholder="Enter name…" />
        <button class="rm-btn" onclick="removePerson(this)">×</button>
      </div>
    </div>
    <button class="add-btn" onclick="addPerson('tariff')">+ Add person</button>
  </div>
  <div class="people-group" id="groupFactual" hidden>
    <div class="group-head"><span class="type-badge factual">FACTUAL</span><span class="group-note">no filters — all rows are split</span></div>
    <div class="people-list" data-group="factual">
      <div class="person-row">
        <span class="person-num">1</span>
        <input class="person-input" type="text" placeholder="Enter name…" />
        <button class="rm-btn" onclick="removePerson(this)">×</button>
      </div>
    </div>
    <button class="add-btn" onclick="addPerson('factual')">+ Add person</button>
  </div>
```

(The two `.toggle-row` blocks after it stay unchanged.)

- [ ] **Step 2: Add group CSS** — insert after the `.type-badge.factual { ... }` rule:

```css
  .people-group { margin-bottom: 18px; }
  .people-group[hidden] { display: none; }
  .group-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .group-note { font-size: 12px; color: var(--text3); }
```

- [ ] **Step 3: Rework the people JS**

3a. Replace the constant `const NAMES_KEY = 'fileSplitter.names';` with:

```js
  const NAMES_KEYS = { tariff: 'fileSplitter.names', factual: 'fileSplitter.namesFactual' };
  const GROUPS = [['tariff', 'Tariff'], ['factual', 'Factual']];
```

3b. Replace the `peopleListEl` block (both listeners) — from `const peopleListEl = document.getElementById('peopleList');` through the end of the `peopleListEl.addEventListener('input', ...)` block — with:

```js
  // People lists (one per work type): Enter adds/advances within the same
  // list, typing persists names.
  const peopleCard = document.getElementById('peopleCard');
  peopleCard.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('person-input')) {
      e.preventDefault();
      const list = e.target.closest('.people-list');
      const inputs = Array.from(list.querySelectorAll('.person-input'));
      const next = inputs[inputs.indexOf(e.target) + 1];
      if (next) next.focus(); else addPerson(list.dataset.group);
    }
  });
  peopleCard.addEventListener('input', e => {
    if (e.target.classList.contains('person-input')) { saveNames(); renderWizard(); }
  });
```

3c. Replace the restore IIFE:

```js
  (function restoreNames() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(NAMES_KEY) || '[]'); } catch (e) {}
    if (Array.isArray(saved) && saved.some(v => v && v.trim())) {
      peopleListEl.innerHTML = '';
      saved.forEach(v => addPerson(v));
      if (peopleListEl.children.length === 0) addPerson();
    }
  })();
```

with:

```js
  (function restoreNames() {
    for (const [group, key] of Object.entries(NAMES_KEYS)) {
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
      if (Array.isArray(saved) && saved.some(v => v && v.trim())) {
        const list = document.querySelector(`.people-list[data-group="${group}"]`);
        list.innerHTML = '';
        saved.forEach(v => addPerson(group, v));
        if (list.children.length === 0) addPerson(group);
      }
    }
  })();
```

3d. Replace `saveNames`:

```js
  function saveNames() {
    try {
      for (const [group, key] of Object.entries(NAMES_KEYS)) {
        const vals = Array.from(document.querySelectorAll(`.people-list[data-group="${group}"] .person-input`)).map(i => i.value);
        localStorage.setItem(key, JSON.stringify(vals));
      }
    } catch (e) { /* storage unavailable */ }
  }
```

3e. Replace `addPerson`:

```js
  function addPerson(group, value = '') {
    const list = document.querySelector(`.people-list[data-group="${group}"]`);
    const num = list.children.length + 1;
    const row = document.createElement('div');
    row.className = 'person-row';
    row.innerHTML = `<span class="person-num">${num}</span><input class="person-input" type="text" placeholder="Enter name…" /><button class="rm-btn" onclick="removePerson(this)" title="Remove">×</button>`;
    list.appendChild(row);
    const input = row.querySelector('input');
    input.value = value;
    if (!value) input.focus();
    return input;
  }
```

3f. Replace `removePerson` and DELETE `reNumberPeople` (its only caller):

```js
  function removePerson(btn) {
    const list = btn.closest('.people-list');
    if (list.children.length > 1) {
      btn.closest('.person-row').remove();
      list.querySelectorAll('.person-num').forEach((el, i) => el.textContent = i + 1);
      saveNames();
      renderWizard();
    }
  }
```

3g. Replace `getNames`:

```js
  function getNames(group) {
    return Array.from(document.querySelectorAll(`.people-list[data-group="${group}"] .person-input`)).map(i => i.value.trim()).filter(Boolean);
  }
```

- [ ] **Step 4: Gate + visibility in the wizard**

4a. Replace `stepUnlocked`:

```js
  function stepUnlocked(i) {
    const valid = systems.filter(s => !s.error);
    const hasFiles = valid.length > 0;
    const groups = [...new Set(valid.map(s => s.group))];
    const hasNames = hasFiles && groups.every(g => getNames(g).length > 0);
    return i <= 0 ? true : i === 1 ? hasFiles : hasFiles && hasNames;
  }
```

4b. In `renderWizard`, insert right after the `document.querySelectorAll('.step-card').forEach(...)` line:

```js
    const inUse = new Set(systems.filter(s => !s.error).map(s => s.group));
    document.getElementById('groupTariff').hidden = inUse.size > 0 && !inUse.has('tariff');
    document.getElementById('groupFactual').hidden = !inUse.has('factual');
```

4c. Still in `renderWizard`, replace the hint line `: 'Add at least one name to continue';` with:

```js
      : 'Add at least one name to each list to continue';
```

4d. **Temporary shims so the app stays runnable until Task 5:** in `splitFile`, change `const names = getNames();` to `const names = getNames('tariff');` and in `renderRecap`, change `const names = getNames();` to `const names = getNames('tariff');` (Task 5 rewrites both functions).

- [ ] **Step 5: Run tests (regression — also proves the vm harness still loads the script)**

Run: `node --test "tests/*.test.mjs"`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): separate Tariff and Factual people lists with own persistence"
```

---

### Task 5: Per-group split jobs, filenames, recap, results

**Files:**
- Modify: `File_splitter.html` — `splitFile`, `renderRecap`, `renderResults`

**Interfaces:**
- Consumes: `GROUPS`, `getNames(group)` (Task 4), `splitRows` (Task 2), `sys.group` (Task 3).
- Produces: `generatedFiles` entries gain `group` ('tariff'|'factual') and `label` ('Tariff'|'Factual').

- [ ] **Step 1: Replace `renderRecap` entirely** with:

```js
  // Recap chips for the split step: one chip per work type in use (systems,
  // surviving rows, people), then the global options + PRIO chips.
  function renderRecap() {
    const valid = systems.filter(s => !s.error);
    const keep = checkedNoteSet();
    const skipBlanks = document.getElementById('skipBlanks').checked;
    const shuffle = document.getElementById('shuffleRows').checked;
    const chips = [];
    let prioHits = 0;
    for (const [group, label] of GROUPS) {
      const groupSys = valid.filter(s => s.group === group);
      if (groupSys.length === 0) continue;
      let planned = 0;
      for (const sys of groupSys) {
        const rows = splitRows(sys, keep, skipBlanks);
        planned += rows.length;
        if (prio) for (const r of rows) if (prio.docs.has(normDoc(r[3]))) prioHits++;
      }
      const names = getNames(group);
      chips.push(`${label} · ${groupSys.length} system${groupSys.length === 1 ? '' : 's'} · ${planned} rows → ${names.length} ${names.length === 1 ? 'person' : 'people'}`);
    }
    const noteFilterOn = noteChecked.size > 0 && keep.size < noteChecked.size;
    chips.push(`${skipBlanks ? 'blanks skipped' : 'blanks kept'} · ${shuffle ? 'shuffled' : 'in order'}${noteFilterOn ? ' · notes filtered' : ''}`);
    if (prio) chips.push(`PRIO list · ${prioHits} match${prioHits === 1 ? '' : 'es'}`);
    document.getElementById('recapChips').innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join('');
  }
```

- [ ] **Step 2: Replace `splitFile` entirely** with:

```js
  async function splitFile() {
    hideError();
    const valid = systems.filter(s => !s.error);
    if (valid.length === 0) { showError('Please upload at least one system file with the required columns.'); return; }

    // One job per work type in use: its own systems and its own people list.
    const jobs = [];
    for (const [group, label] of GROUPS) {
      const groupSys = valid.filter(s => s.group === group);
      if (groupSys.length === 0) continue;
      const names = getNames(group);
      if (names.length === 0) { showError(`Please enter at least one ${label} person name.`); return; }
      jobs.push({ group, label, names, systems: groupSys });
    }

    const skipBlanks = document.getElementById('skipBlanks').checked;
    const doShuffle = document.getElementById('shuffleRows').checked;
    generatedFiles.forEach(f => URL.revokeObjectURL(f.url));
    generatedFiles = [];
    document.getElementById('results').innerHTML = '';
    document.getElementById('results').classList.remove('show');
    document.getElementById('dlAllBtn').classList.add('hide');

    const btn = document.getElementById('splitBtn');
    btn.disabled = true;
    splitting = true;
    renderWizard();
    setProgress(0, 'Starting…');
    document.getElementById('progressWrap').classList.add('show');

    try {
      const total = jobs.reduce((n, j) => n + j.names.length * j.systems.length, 0);
      let done = 0;
      const keepNotes = checkedNoteSet();
      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;

      for (const job of jobs) {
        // Filter each system per its group policy, then pre-shuffle once so all
        // people draw from the same pool. Balanced slice boundaries spread the
        // remainder fairly instead of starving the last person.
        const pool = {};
        const bounds = {};
        for (const sys of job.systems) {
          const dataRows = splitRows(sys, keepNotes, skipBlanks);
          const rows = doShuffle ? shuffleArray(dataRows) : dataRows;
          pool[sys.name] = rows;

          const sizes = balancedSizes(rows.length, job.names.length);
          const b = [];
          let off = 0;
          for (const s of sizes) { b.push([off, off + s]); off += s; }
          bounds[sys.name] = b;
        }

        const usedNames = {}; // per job — the Tariff/Factual filename token separates jobs
        for (let i = 0; i < job.names.length; i++) {
          const name = job.names[i];
          const wb = XLSX.utils.book_new();
          const sheetSummary = {};

          for (const sys of job.systems) {
            const rows = pool[sys.name];
            const [start, end] = bounds[sys.name][i];
            const chunk = rows.slice(start, end);
            chunk.sort(outputRowOrder); // forwarder A→Z, doc Z→A within; the shared pool stays untouched

            sheetSummary[sys.name] = chunk.length;

            // With a PRIO list loaded the sheet gains a trailing column: 'PRIO'
            // on matching doc numbers, yellow fill on the doc + PRIO cells.
            const header = prio ? [...TARGET_COLS, 'PRIO'] : TARGET_COLS;
            const cells = chunk.map(r => prio
              ? [...r.slice(0, 4), prio.docs.has(normDoc(r[3])) ? 'PRIO' : '']
              : r.slice(0, 4));
            const ws = XLSX.utils.aoa_to_sheet([header, ...cells]);
            for (let R = 0; R <= cells.length; R++) for (let C = 0; C < header.length; C++) {
              const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
              if (cell) cell.s = R === 0 ? HEADER_STYLE
                : C >= 3 && cells[R - 1][4] === 'PRIO' ? PRIO_STYLE : DATA_STYLE;
            }
            ws['!cols'] = colWidths(header, cells);
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: cells.length, c: header.length - 1 } }) };
            XLSX.utils.book_append_sheet(wb, ws, sys.name);

            done++;
            setProgress(Math.round((done / total) * 100), `Building ${name} — ${sys.name}…`);
            await sleep(10);
          }

          const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([wbout], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          // Build a safe, unique filename (handles duplicate / blank names).
          let base = name.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_') || `person_${i + 1}`;
          usedNames[base] = (usedNames[base] || 0) + 1;
          if (usedNames[base] > 1) base += `_${usedNames[base]}`;
          const fileName = `${base}_${job.label}_${dateStr}.xlsx`;
          generatedFiles.push({ name, group: job.group, label: job.label, fileName, url, blob, sheetSummary });
        }
      }

      setProgress(100, 'Done!');
      await sleep(400);
      renderResults();
    } catch (err) {
      showError('Split failed: ' + err.message);
    } finally {
      document.getElementById('progressWrap').classList.remove('show');
      btn.disabled = false;
      splitting = false;
      renderWizard();
    }
  }
```

- [ ] **Step 3: Result cards show the work type** — in `renderResults`, replace:

```js
          <div class="result-name">${escapeHtml(f.name)} ${hasEmpty ? '<span class="warn-badge">some sheets empty</span>' : ''}</div>
```

with:

```js
          <div class="result-name">${escapeHtml(f.name)} <span class="type-badge ${f.group}">${f.label.toUpperCase()}</span> ${hasEmpty ? '<span class="warn-badge">some sheets empty</span>' : ''}</div>
```

- [ ] **Step 4: Run tests (regression)**

Run: `node --test "tests/*.test.mjs"`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): split per work type — Name_Tariff/_Factual files, per-group recap"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test run**

Run: `node --test "tests/*.test.mjs"`
Expected: all tests PASS, 0 fail

- [ ] **Step 2: Browser smoke test** — serve the repo root (e.g. preview server on `File_splitter.html`) and drive state via console/eval, since no real xlsx files are on hand:

```js
// Inject one tariff + one factual system, then walk the wizard.
systems.push(
  { id: 'sysA', name: 'FNP', fileName: 'FNP.xlsx', group: 'tariff',
    rows: [['DHL', 'S1', 'R1', '9001', []], ['Kuehne', 'S2', 'R2', '9002', ['kreditor fehlt']]],
    forwarders: [{ name: 'DHL', count: 1, checked: true }, { name: 'Kuehne', count: 1, checked: true }] },
  { id: 'sysB', name: 'KSP', fileName: 'KSP.xlsx', group: 'factual',
    rows: [['Schenker', 'S3', 'R3', '9003', []]],
    forwarders: [{ name: 'Schenker', count: 1, checked: true }] });
renderSystems(); rebuildNoteFilter(); updateNoteStat(); renderWizard();
```

Verify (snapshot/inspect, not screenshots):
- Step 1: FNP card shows TARIFF badge + forwarder list; KSP card shows FACTUAL badge, no forwarder list, meta "1 rows".
- Step 2: both people sections visible; Continue disabled until both lists have a name.
- Step 3: note list contains only `kreditor fehlt` (from the tariff file).
- Step 4: recap shows a Tariff chip and a Factual chip; after Split, result cards read `..._Tariff_...xlsx` / `..._Factual_...xlsx` with TARIFF/FACTUAL badges.
- Console: no errors.

- [ ] **Step 3: Verify factual-only path** — reload page, inject only the KSP factual system (same eval minus sysA): tariff people section hidden, notes step shows the "No Note values found" empty state, split produces only `_Factual_` files.

- [ ] **Step 4: Commit any fixes found, then hand off** — merge/PR per `superpowers:finishing-a-development-branch`.
