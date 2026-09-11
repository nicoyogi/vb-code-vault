# Exclude Referenz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-system Referenz exclusion feature to File Splitter, allowing users to exclude rows by Reference value in both Tariff and Factual groups, persisted locally and synced via Firestore.

**Architecture:** Extend the Step 3 wizard card from "Exclude Kreditor" to "Exclusions" with dual textareas (Kreditor and Referenz) per system. Implement `parseReferenz()` and `referenzSetFor()` pure functions, update `splitRows()` to filter by Reference (row[2]) in addition to Supplier (row[1]), and mirror Firestore/localStorage sync (`wmf_splitter_config/referenz`).

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5, CSS3, SheetJS (xlsx-js-style), Firebase Firestore compat, Node.js `node:test` test runner.

## Global Constraints

- File Splitter is a single self-contained HTML file: `File_splitter.html`.
- Pure business logic must be exported/exposed to the window context so unit tests in `tests/splitter.test.mjs` (via `loadSplitter` in `tests/harness/load-splitter.mjs`) can exercise it directly.
- Matching must be exact, case-insensitive, after whitespace trimming (`normDoc(r[2]).toLowerCase()`).
- Multiple values can be separated by newlines, commas, semicolons, or whitespace.
- Exclusions must apply to all rows (Tariff and Factual, including PRIO-injected rows).
- Follow Ponytail guidelines: minimal code, native stdlib/CSS, no unneeded abstractions.

---

### Task 1: Core Logic — `parseReferenz` and `splitRows` Referenz Filtering with Tests

**Files:**
- Modify: `File_splitter.html:820-840`
- Test: `tests/splitter.test.mjs:238-265`

**Interfaces:**
- Produces: `parseReferenz(text: string): Set<string>` (lower-cased, trimmed values)
- Produces: `referenzSetFor(name: string): Set<string>`
- Updates: `splitRows(sys: object, keepNotes: Set, skipBlanks: boolean, kreditorExcl?: Set, referenzExcl?: Set): Array`

- [ ] **Step 1: Write the failing tests in `tests/splitter.test.mjs`**

Add tests for `parseReferenz` and `splitRows` with `referenzExcl`:

```javascript
test('parseReferenz: splits on newline/comma/semicolon/space, lowercases, drops blanks', () => {
  assert.deepEqual([...s.parseReferenz('REF-1\nRef-2, ref-3;REF-4  ref-5')].sort(),
    ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5']);
  assert.equal(s.parseReferenz('').size, 0);
  assert.equal(s.parseReferenz(undefined).size, 0);
});

test('splitRows: Referenz exclusion drops Reference matches (case-insensitive) in every group', () => {
  const rows = [
    ['DHL', '111', 'REF-ABC', 'D1', []],
    ['DHL', '222', 'REF-XYZ', 'D2', []],
    ['DHL', '333', '12345',   'D3', []],
  ];
  const fwd = [{ name: 'DHL', checked: true }];
  const excl = s.parseReferenz('ref-abc, 12345');
  // Tariff group
  assert.deepEqual(plain(s.splitRows({ group: 'tariff', rows, forwarders: fwd }, new Set(), true, null, excl)),
    [['DHL', '222', 'REF-XYZ', 'D2', []]]);
  // Factual group
  assert.deepEqual(plain(s.splitRows({ group: 'factual', rows }, new Set(), true, null, excl)),
    [['DHL', '222', 'REF-XYZ', 'D2', []]]);
  // Both Kreditor and Referenz exclusions combined
  const kredExcl = s.parseKreditors('222');
  assert.deepEqual(plain(s.splitRows({ group: 'tariff', rows, forwarders: fwd }, new Set(), true, kredExcl, excl)),
    []);
  // Numeric Reference cells match via normDoc
  assert.deepEqual(plain(s.splitRows({ group: 'factual', rows: [['V', 'S', 12345, 'D', []]] }, new Set(), true, null, excl)),
    []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/splitter.test.mjs"`
Expected: FAIL with `s.parseReferenz is not a function`

- [ ] **Step 3: Implement `parseReferenz`, `referenzSetFor`, and update `splitRows` in `File_splitter.html`**

Add `parseReferenz` and `referenzSetFor` next to `parseKreditors`:

```javascript
  // Referenz exclusion list: one token per line / comma / semicolon / space, normalized to lower case.
  function parseReferenz(text) {
    return new Set(String(text || '').split(/[\s,;]+/).map(v => v.trim().toLowerCase()).filter(Boolean));
  }
  function referenzSetFor(name) { return parseReferenz(referenzStore[name]); }
```

Update `splitRows` to accept `referenzExcl`:

```javascript
  function splitRows(sys, keepNotes, skipBlanks, kreditorExcl, referenzExcl) {
    let rows = sys.rows;
    if (kreditorExcl && kreditorExcl.size) rows = rows.filter(r => !kreditorExcl.has(normDoc(r[1])));
    if (referenzExcl && referenzExcl.size) rows = rows.filter(r => !referenzExcl.has(normDoc(r[2]).toLowerCase()));
    if (sys.group !== 'factual') {
      const checked = new Set(sys.forwarders.filter(f => f.checked).map(f => f.name));
      rows = rows.filter(r => checked.has(r[0]) && noteKeep(r[4], keepNotes));
    }
    return skipBlanks ? rows.filter(r => !isBlankRow(r)) : rows;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/splitter.test.mjs"`
Expected: PASS (all 36 tests pass)

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): implement parseReferenz and splitRows referenz filtering"
```

---

### Task 2: Persistence & Sync — LocalStorage and Firestore for Referenz Store

**Files:**
- Modify: `File_splitter.html:320-365`

**Interfaces:**
- Produces: `referenzStore: Record<string, string>`
- Produces: `initReferenzSync(): void`
- Produces: `saveReferenz(name: string): void`
- Updates: `initKreditorSync()` / init flow to also load Referenz lists

- [ ] **Step 1: Add Referenz state variables and storage keys in `File_splitter.html`**

Under `kreditorStore` (around line 323), add:
```javascript
  let referenzStore = {};  // system name -> raw Referenz-exclusion text
  const REFERENZ_KEY = 'fileSplitter.referenz';
  try { referenzStore = JSON.parse(localStorage.getItem(REFERENZ_KEY) || '{}') || {}; } catch (e) {}

  let referenzDirty = new Set();
  let referenzSaveTimer = null;
  function referenzDoc() { return firebase.firestore().collection('wmf_splitter_config').doc('referenz'); }
  let referenzLoaded = false;
  function initReferenzSync() {
    if (typeof firebase === 'undefined' || !firebase.firestore) { referenzLoaded = true; return; }
    if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    referenzDoc().get().then(snap => {
      const lists = snap.exists && snap.data().lists;
      if (!lists) return;
      referenzStore = lists;
      try { localStorage.setItem(REFERENZ_KEY, JSON.stringify(referenzStore)); } catch (e) {}
    }).catch(err => console.warn('Referenz lists: Firestore read failed, using local copy.', err))
      .finally(() => { referenzLoaded = true; renderWizard(); });
  }
  function saveReferenz(name) {
    try { localStorage.setItem(REFERENZ_KEY, JSON.stringify(referenzStore)); } catch (e) {}
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
    referenzDirty.add(name);
    clearTimeout(referenzSaveTimer);
    referenzSaveTimer = setTimeout(() => {
      const patch = {};
      for (const n of referenzDirty) patch[n] = referenzStore[n] || '';
      referenzDirty.clear();
      referenzDoc().set({ lists: patch, updatedAt: new Date().toISOString() }, { merge: true })
        .catch(err => console.warn('Referenz lists: Firestore save failed — saved locally only.', err));
    }, 600);
  }
  initReferenzSync();
```

- [ ] **Step 2: Update callers of `splitRows` throughout `File_splitter.html`**

Update the 3 call sites in `File_splitter.html` to pass `referenzSetFor(sys.name)`:

1. In `renderRecap` (around line 918):
```javascript
const rows = splitRows(sys, keep, skipBlanks, kreditorSetFor(sys.name), referenzSetFor(sys.name));
```

2. In `renderTotals` (around line 989):
```javascript
const per = groupSys.map(sys => ({ name: sys.name, rows: splitRows(sys, keep, skipBlanks, kreditorSetFor(sys.name), referenzSetFor(sys.name)).length }));
```

3. In `startSplit` (around line 1346):
```javascript
shares[sys.name] = systemShares(splitRows(sys, keepNotes, skipBlanks, kreditorSetFor(sys.name), referenzSetFor(sys.name)), job.names.length, doShuffle, isPrioRow);
```

- [ ] **Step 3: Update wizard flow guard for the shared-lists loading state**

Referenz exclusions apply to every uploaded system (Tariff and Factual), so
Step 3 is always reachable once a file is uploaded — the old
`kreditorNeeded()` only skipped Kreditor for factual-only uploads because
Kreditor itself had no bearing on factual work. With Referenz now in the
same step, that skip would hide the Referenz box for factual uploads, so the
skip must go. The step-unlock logic simplifies to:

Update `stepUnlocked(i)` to drop the `kreditorNeeded()` skip and check both
stores' loaded state:
```javascript
  function stepUnlocked(i) {
    const valid = systems.filter(s => !s.error);
    if (i <= 0) return true;
    if (valid.length === 0) return false;
    if (i === 2) return true; // exclusions card always shown for any valid upload
    if (i >= 3 && (!kreditorLoaded || !referenzLoaded)) return false; // shared lists still refreshing
    if (i <= 4) return true; // notes, totals, people
    const groups = [...new Set(valid.map(s => s.group))];
    return groups.every(g => getNames(g).length > 0); // split
  }
```

Update `nextStepIdx()` and `goBack()` to remove the skip-jump (step 3 is never
skipped now — `kreditorNeeded()` no longer exists):
```javascript
  function nextStepIdx() { return step + 1; }
  function goBack() { setStep(Math.max(0, step - 1)); }
```

Update hint in `renderWizard` to mention the shared exclusions loading
(both stores must have arrived):
```javascript
      : (!kreditorLoaded || !referenzLoaded) ? 'Loading the shared exclusions — one moment...'
      : 'Add at least one name to each list to continue';
```

Keep the `kreditorNeeded()` function removed; delete it and its comment.

- [ ] **Step 4: Run unit tests to verify existing suite still passes**

Run: `node --test "tests/splitter.test.mjs"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): add referenz store persistence and wire into splitRows callers"
```

---

### Task 3: UI — Step 3 Exclusions Card & Side-by-Side Dual Textareas

**Files:**
- Modify: `File_splitter.html:137-142` (styles)
- Modify: `File_splitter.html:236-241` (HTML template)
- Modify: `File_splitter.html:935-976` (render logic)

- [ ] **Step 1: Add CSS styles for `.excl-cols`, `.excl-col`, and `.kred-sys-title`**

Around line 137 in `<style>`:
```css
  .kred-block { margin-top: 16px; background: var(--surface2); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .kred-sys-title { font-size: 13.5px; font-weight: 600; color: var(--accent); margin-bottom: 10px; font-family: var(--mono); }
  .excl-cols { display: flex; gap: 14px; }
  @media (max-width: 620px) { .excl-cols { flex-direction: column; } }
  .excl-col { flex: 1; min-width: 0; }
  .excl-col label { display: block; font-size: 11.5px; font-weight: 500; color: var(--text2); margin-bottom: 5px; }
  .kred-input { width: 100%; min-height: 64px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; font-family: var(--mono); color: var(--text); outline: none; resize: vertical; transition: border-color 0.15s; }
  .kred-input:focus { border-color: var(--accent); }
  .excl-col .note-stat { margin-top: 5px; font-size: 11px; }
```

- [ ] **Step 2: Update Step 3 HTML markup in `File_splitter.html`**

Update card around line 236:
```html
<div class="card step-card" hidden>
  <div class="card-head"><h2>Exclusions <span class="opt-tag">optional</span></h2><span class="step-tag">step 3 of 6</span></div>
  <p class="card-desc">Per system: <strong>Supplier</strong> (Kreditor) numbers and <strong>Reference</strong> (Referenz) values that should <strong>not</strong> be extracted — one per line or comma-separated. Saved online and reloads next time, on any computer.</p>
  <div id="kreditorBody"><div class="note-empty">No files uploaded yet — nothing to exclude here.</div></div>
</div>
```

Also update sub-header line 205:
```html
<p class="sub">Six quick steps: upload your files, filter notes, exclude Kreditors & Referenz, check totals, add people, and download the split.</p>
```

Update `STEP_LABELS` (around line 324):
```javascript
const STEP_LABELS = ['Files', 'Notes', 'Exclusions', 'Totals', 'People', 'Split'];
```

- [ ] **Step 3: Update `renderKreditor` to render both textareas with live stats**

Update `renderKreditor()`:
```javascript
  // Exclusions step: saved Kreditor and Referenz exclusion textareas per distinct system name.
  function renderKreditor() {
    const body = document.getElementById('kreditorBody');
    if (!kreditorLoaded || !referenzLoaded) {
      body.innerHTML = '<div class="note-empty">Loading shared exclusions…</div>';
      return;
    }
    body.innerHTML = '';
    const names = [...new Set(systems.filter(s => !s.error).map(s => s.name))];
    if (names.length === 0) {
      body.innerHTML = '<div class="note-empty">No files uploaded yet — nothing to exclude here.</div>';
      return;
    }
    for (const name of names) {
      const block = document.createElement('div');
      block.className = 'kred-block';
      block.innerHTML = `
        <div class="kred-sys-title">${escapeHtml(name)}</div>
        <div class="excl-cols">
          <div class="excl-col">
            <label>Exclude Kreditor (Supplier)</label>
            <textarea class="kred-input kred-ta" rows="3" placeholder="Kreditor numbers — one per line or comma-separated"></textarea>
            <div class="note-stat kred-stat"></div>
          </div>
          <div class="excl-col">
            <label>Exclude Referenz (Reference)</label>
            <textarea class="kred-input ref-ta" rows="3" placeholder="Referenz values — one per line or comma-separated"></textarea>
            <div class="note-stat ref-stat"></div>
          </div>
        </div>`;

      const kredTa = block.querySelector('.kred-ta');
      const kredStat = block.querySelector('.kred-stat');
      const refTa = block.querySelector('.ref-ta');
      const refStat = block.querySelector('.ref-stat');

      kredTa.value = kreditorStore[name] || '';
      refTa.value = referenzStore[name] || '';

      const updateKredStat = () => {
        const excl = parseKreditors(kredTa.value);
        let hit = 0;
        for (const sys of systems) if (!sys.error && sys.name === name)
          for (const r of sys.rows) if (excl.has(normDoc(r[1]))) hit++;
        kredStat.textContent = excl.size === 0 ? ''
          : `${excl.size} Kreditor${excl.size === 1 ? '' : 's'} listed — excludes ${hit} row${hit === 1 ? '' : 's'}.`;
      };

      const updateRefStat = () => {
        const excl = parseReferenz(refTa.value);
        let hit = 0;
        for (const sys of systems) if (!sys.error && sys.name === name)
          for (const r of sys.rows) if (excl.has(normDoc(r[2]).toLowerCase())) hit++;
        refStat.textContent = excl.size === 0 ? ''
          : `${excl.size} Referenz listed — excludes ${hit} row${hit === 1 ? '' : 's'}.`;
      };

      kredTa.addEventListener('input', () => {
        kreditorStore[name] = kredTa.value;
        saveKreditors(name);
        updateKredStat();
      });

      refTa.addEventListener('input', () => {
        referenzStore[name] = refTa.value;
        saveReferenz(name);
        updateRefStat();
      });

      updateKredStat();
      updateRefStat();
      body.appendChild(block);
    }
  }
```

- [ ] **Step 4: Run unit tests**

Run: `node --test "tests/splitter.test.mjs"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): UI for dual Kreditor and Referenz exclusions step"
```

---

### Task 4: Integration Verification & Regression Testing

**Files:**
- Test: `tests/splitter.test.mjs`

- [ ] **Step 1: Add end-to-end split simulation test in `tests/splitter.test.mjs`**

Add a test verifying full flow with both Kreditor and Referenz exclusions and PRIO rows:

```javascript
test('splitRows: end-to-end exclusion with Kreditor, Referenz, and PRIO rows', () => {
  const normalRows = [
    ['DHL', 'K10', 'REF-001', 'D101', []],
    ['DHL', 'K20', 'REF-002', 'D102', []],
    ['DHL', 'K30', 'REF-003', 'D103', []],
  ];
  const prioRows = [
    ['DHL', 'K10', 'REF-004', 'D104', []], // K10 excluded
    ['DHL', 'K40', 'REF-005', 'D105', []], // kept
    ['DHL', 'K50', 'REF-001', 'D106', []], // REF-001 excluded
  ];
  const sys = {
    name: 'FNP',
    group: 'tariff',
    rows: [...normalRows, ...prioRows],
    forwarders: [{ name: 'DHL', checked: true }]
  };
  const kredExcl = s.parseKreditors('K10');
  const refExcl = s.parseReferenz('ref-001');

  const kept = s.splitRows(sys, new Set(), true, kredExcl, refExcl);
  // D101 dropped (ref-001 & K10), D104 dropped (K10), D106 dropped (ref-001)
  assert.deepEqual(plain(kept.map(r => r[3])), ['D102', 'D103', 'D105']);
});
```

- [ ] **Step 2: Run all test suites across the repository**

Run: `node --test "tests/*.test.mjs"`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add tests/splitter.test.mjs
git commit -m "test(splitter): add integration test for combined exclusions"
```
