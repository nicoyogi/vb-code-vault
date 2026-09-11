# Half-Day People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each person in the File Splitter be marked half-day so their share of rows is half a full-day person's, with no time-cost model.

**Architecture:** The pure sharing helpers in `File_splitter.html` (`balancedSizes`, `sliceBounds`, `systemShares`) move from a parts `count` to per-person `weights` (`0.5` for half-day, `1` for full). Step 5 gains a toggle per person; the recap chip shows the full/half mix. Tests live in `tests/splitter.test.mjs` via the existing vm harness (`tests/harness/load-splitter.mjs`).

**Tech Stack:** Plain HTML/CSS/JS single file (`File_splitter.html`), `node --test` + `node:vm` harness, xlsx-js-style (existing).

## Global Constraints

- Bare `sliceBounds(n, parts)` stays callable: internally `sliceBounds(n, weights)` always — it converts to weights internally (`n` unchanged). Replace loops' `.length` uses only.
- All-full weights must reproduce today's exact banding: `sliceBounds(n, [1,1,1])` equals old `sliceBounds(n, 3)` for the same n.
- Weights are `0.5` (half-day) or `1` (full). Half-day toggle is per person, per work type (Tariff and Factual), default OFF.
- Rows are NEVER split mid-row and document-band snapping (`snapBoundsToDocRuns`) is unchanged.
- Non-halfday people (all toggles off) → identical output to the current feature branch (`feat/splitter-exclude-referenz`) for identical input.
- Commits end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

---
## File Structure

- `File_splitter.html` — splitter wizard (all UI + pure helpers in one inline `<script>`).
- `tests/splitter.test.mjs` — unit tests for the pure helpers.
- `tests/harness/load-splitter.mjs` — existing vm harness; **not modified**.
- `docs/superpowers/specs/2026-09-11-halfday-people-design.md` — design spec (already committed, `b38f0d8`).

---

### Task 1: Weighted sliceBounds

Widens the row-distribution cutoff from equal `parts` to proportional `weights`. Later tasks depend on its signature.

**Files:**
- Modify: `File_splitter.html:1315-1332` (the `balancedSizes` + `sliceBounds` helpers)
- Test: `tests/splitter.test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `balancedSizes(n, weights) -> number[]` — sizes proportional to weights, sum `n`, non-negative.
  - `sliceBounds(n, weights) -> [start, end)[]` — contiguous, sum-covers `n`, starts at 0.

- [ ] **Step 1: Verify current tests fail**

Run: `node --test "tests/*.test.mjs"`
Expected: 221 pass, 0 fail (baseline before any change).

- [ ] **Step 2: Add the failing tests**

Append to `tests/splitter.test.mjs`:

```js
test('balancedSizes: proportional to weights, sums to n (largest-remainder)', () => {
  assert.deepEqual(plain(s.balancedSizes(9, [1, 0.5])), [6, 3]);          // 1 full + 1 half -> 2:1
  assert.deepEqual(plain(s.balancedSizes(10, [1, 1, 0.5])), [4, 4, 2]);   // 2 full + 1 half -> 2:2:1
  assert.deepEqual(plain(s.balancedSizes(100, [1, 0.5, 0.5])), [50, 25, 25]);
  // edge cases
  assert.deepEqual(plain(s.balancedSizes(0, [1, 0.5])), [0, 0]);          // nothing to give
  assert.deepEqual(plain(s.balancedSizes(3, [0.5])), [3]);                // single half-day person takes all
  assert.deepEqual(plain(s.balancedSizes(6, [1, 1])), [3, 3]);            // all full -> equal (old balancedSizes(6,2))
  const sizes = s.balancedSizes(79, [1, 1, 1]);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 79);                     // nothing lost/duplicated
});

test('sliceBounds: contiguous [start,end) bands proportional to weights, covers all n', () => {
  assert.deepEqual(plain(s.sliceBounds(6, [1, 0.5])), [[0, 4], [4, 6]]);       // 4:2
  assert.deepEqual(plain(s.sliceBounds(0, [1, 0.5])), [[0, 0], [0, 0]]);
  const b = s.sliceBounds(79, [1, 1, 1]);
  assert.equal(b[0][0], 0);
  assert.equal(b[b.length - 1][1], 79);                                  // covers everything
  for (let i = 1; i < b.length; i++) assert.equal(b[i][0], b[i - 1][1]); // no gaps, no overlap
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test "tests/*.test.mjs" 2>&1`
Expected: both new tests FAIL (e.g. `expected [ 6, 3 ] but received [ 5, 4 ]` from the old equal split).

- [ ] **Step 4: Implement weighted `balancedSizes` + `sliceBounds`**

In `File_splitter.html`, replace the `balancedSizes` + `sliceBounds` block (lines 1315-1332, from `function balancedSizes` through the closing `}` of `sliceBounds`) with:

```js
  // Spread n rows across `parts` people (each weight: 1 full day, 0.5 half day)
  // as evenly as the weights allow. e.g. balancedSizes(9, [1, 0.5]) -> [6, 3].
  // Largest-remainder rounding keeps every share within ±1 of exact
  // proportion; a weight list that sums to 0 is not valid here.
  function balancedSizes(n, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    const ideal = w => (n * w) / total;
    let floor = weights.map(w => Math.floor(ideal(w)));
    let rem = n - floor.reduce((a, b) => a + b, 0);
    const order = weights.map((w, i) => ({ i, f: ideal(w) - Math.floor(ideal(w)) }))
      .sort((a, b) => b.f - a.f);
    for (let k = 0; k < rem; k++) floor[order[k % order.length].i]++;
    return floor;
  }

  // Cut n rows into `parts` contiguous [start, end) slices sized by each
  // person's weight. e.g. sliceBounds(6, [1, 0.5]) -> [[0, 4], [4, 6]].
  function sliceBounds(n, weights) {
    const b = [];
    let off = 0;
    for (const size of balancedSizes(n, weights)) { b.push([off, off + size]); off += size; }
    return b;
  }
```

- [ ] **Step 5: Update old `balancedSizes`-only tests to pass weights**

In `tests/splitter.test.mjs`, the existing test at line 74 (`test('balancedSizes: spreads remainder to the front, sums to n'`) still calls `s.balancedSizes(5, 4)` with a count. Update just the **callers** to pass weights (the equal case: `[1,1,1]`, `[1,1,1,1]`):

```js
test('balancedSizes: spreads remainder to the front (equal weights), sums to n', () => {
  assert.deepEqual(plain(s.balancedSizes(5, [1, 1, 1, 1])), [2, 1, 1, 1]);
  assert.deepEqual(plain(s.balancedSizes(8, [1, 1, 1, 1])), [2, 2, 2, 2]);
  assert.deepEqual(plain(s.balancedSizes(0, [1, 1, 1])), [0, 0, 0]);
  const sizes = s.balancedSizes(79, [1, 1, 1]);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 79); // nothing lost/duplicated
});
```

- [ ] **Step 6: Run the full suite — all pass**

Run: `node --test "tests/*.test.mjs" 2>&1`
Expected: 223 pass, 0 fail (2 new tests + 221 baseline; the updated `balancedSizes` test replaces the old one).

- [ ] **Step 7: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): weighted sliceBounds for half-day shares

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Weights wired through systemShares + split flow

Makes the whole split pipeline weight-aware: `systemShares` takes weights; `splitFile()` builds the weight list per job and passes it through; recap shows the mix.

**Files:**
- Modify: `File_splitter.html` (`systemShares` ~1361, `splitFile` job loop ~1381-1423, `renderRecap` ~948-977)
- Test: `tests/splitter.test.mjs`

**Interfaces:**
- Consumes: `sliceBounds(n, weights)` (Task 1).
- Produces:
  - `systemShares(rows, weights, doShuffle, isPrioRow) -> rows[][]` — per-share arrays, weights-sized bands in both PRIO and main pools.
  - `weightsForNames(getNamesChecked()) -> number[]` (a global helper; `0.5` for a checked half-day name, else `1`).
  - `halfChecked` — a `Map`-free, `Set`-based `halfNames: Set<string>` per group, inlined (group-local) — see below.

- [ ] **Step 1: Add the failing test**

In `tests/splitter.test.mjs`, append:

```js
test('systemShares: half-day weight sizes shares ~half of full-day, both pools covered once', () => {
  const row = (doc, isP) => ['V', 'S', 'R', doc, [], isP ? new Date(2026, 6, 6) : ''];
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push(row('P' + i, true));   // 9 PRIO
  for (let i = 0; i < 9; i++) rows.push(row('R' + i, false));  // 9 rest
  const isPrioRow = r => !!r[5];
  for (const doShuffle of [false, true]) {
    const shares = s.systemShares(rows, [1, 0.5], doShuffle, isPrioRow); // full + half
    assert.equal(shares.length, 2);
    // every row covered exactly once
    assert.deepEqual(plain(shares.flat().map(r => r[3]).sort()), plain(rows.map(r => r[3]).sort()));
    // main-pool split is ~2:1 within ±1
    const main = shares.map(sh => sh.filter(r => !isPrioRow(r)).length);
    assert.equal(Math.abs(main[0] - 2 * main[1]) <= 1, true, `main ≈2:1, got ${main}`);
    // PRIO split is ~2:1 within ±1
    const prio = shares.map(sh => sh.filter(isPrioRow).length);
    assert.equal(Math.abs(prio[0] - 2 * prio[1]) <= 1, true, `prio ≈2:1, got ${prio}`);
  }
  // all-full weights -> equal shares, identical to the pre-weights path
  const rows2 = [row('P0', true), row('P1', true), row('R0', false), row('R1', false)];
  const s1 = s.systemShares(rows2, [1, 1], false, isPrioRow);
  const s2 = s.systemShares(rows2, 2, false, isPrioRow);
  assert.deepEqual(plain(s1), plain(s2));
});

test('systemShares: more shares than rows (weights) -> empty shares, nothing lost', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  const shares = s.systemShares([row('1')], [1, 0.5], false, () => false);
  assert.deepEqual(plain(shares.map(sh => sh.length)), [1, 0]); // full takes all, half gets 0
});
```

- [ ] **Step 2: Run to confirm they fail**

Expected: both FAIL — `systemShares` still takes a `parts` count, so `[1, 0.5]` is treated as a count (2), producing equal not 2:1 bands.

- [ ] **Step 3: Implement `systemShares`, `weightsForNames`, `halfNames`**

In `File_splitter.html`, **replace** `function systemShares(...)` (currently lines 1361-1373) with:

```js
  // Split one system's filtered rows into `weights.length` shares.
  // PRIO rows and the rest split as two independent pools so urgent work
  // lands evenly (±1 per share); each pool runs through the doc-band
  // machinery — doc-sorted, weighted contiguous bands, cuts nudged off
  // equal-doc runs, band→person assignment shuffled per pool (shuffle ON)
  // or in-order slices (OFF). With no PRIO rows this is exactly the
  // single-pool split. A weight of 0.5 = half-day → half a full share.
  function systemShares(rows, weights, doShuffle, isPrioRow) {
    const pools = [[], []];
    for (const r of rows) pools[isPrioRow(r) ? 0 : 1].push(r);
    const shares = Array.from({ length: weights.length }, () => []);
    for (const p of pools) {
      if (p.length === 0) continue;
      const pool = doShuffle ? [...p].sort(docNumDesc) : p;
      const b = sliceBounds(pool.length, weights);
      const bounds = doShuffle ? shuffleArray(snapBoundsToDocRuns(b, pool)) : b;
      shares.forEach((share, i) => share.push(...pool.slice(bounds[i][0], bounds[i][1])));
    }
    return shares;
  }

  // Per-person split weight: half-day people carry 0.5, everyone else 1.
  // names is the current people list (strings), halfNames the subset marked
  // half-day.
  function weightsForNames(names, halfNames) {
    return names.map(n => halfNames.has(n) ? 0.5 : 1);
  }
```

**Important:** the vm harness stubs `document.querySelectorAll` to `[]`, so the half-checkbook must be derived from the **input halfNames set**, NOT from DOM reads inside the tested function.

- [ ] **Step 4: Add the group-level half-day bookkeeping**

The existing group-local state lives in `NAMES_KEYS` (persisted) + `getNames(group)` (reads DOM). Add a `halfNames` map next to the persisted-people restore (around line 516), so the UI knows which names are half-day, and update `getNames` to drive the recap/toggles:

For the persistence + restore — **change this existing block** (currently lines 516-534, the `restoreNames` IIFE) **to**:

```js
  // Restore previously entered names and half-day flags, per work type.
  const HALF_KEYS = { tariff: 'fileSplitter.halfNames', factual: 'fileSplitter.halfNamesFactual' };
  let halfChecked = {}; // group -> Set<string> of names marked half-day
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
    halfChecked = Object.fromEntries(
      Object.entries(NAMES_KEYS).map(([group, key]) => {
        const key2 = HALF_KEYS[group];
        let arr = [];
        try { arr = JSON.parse(localStorage.getItem(key2) || '[]'); } catch (e) {}
        return [group, new Set(Array.isArray(arr) ? arr : [])];
      })
    );
  })();
```

Then define `currentHalf(group)` returning the `Set` for a group (used by toggles + `weightsForNames`), and persist it when a toggle flips:

```js
  function currentHalf(group) { return halfChecked[group] || (halfChecked[group] = new Set()); }
  function saveHalfChecked() {
    try {
      for (const [group, key] of Object.entries(HALF_KEYS))
        localStorage.setItem(key, JSON.stringify([...currentHalf(group)]));
    } catch (e) { /* storage unavailable */ }
  }
```

- [ ] **Step 5: Wire weights into `splitFile`**

In `splitFile()` (around line 1422), **replace** the per-system share line:

```js
          shares[sys.name] = systemShares(splitRows(sys, keepNotes, skipBlanks, kreditorSetFor(sys.name), referenzSetFor(sys.name)), job.names.length, doShuffle, isPrioRow);
```

**with**:

```js
          shares[sys.name] = systemShares(splitRows(sys, keepNotes, skipBlanks, kreditorSetFor(sys.name), referenzSetFor(sys.name)), weightsForNames(job.names, currentHalf(job.group)), doShuffle, isPrioRow);
```

(`job.names` stays the source of truth for the number of people; weights only affect band sizes.)

- [ ] **Step 6: Recap chip shows the mix**

In `renderRecap()` (`renderRecap` around line 948-977), **change the chip push** for each group:

```js
      const names = getNames(group);
      chips.push(`${label} · ${groupSys.length} system${groupSys.length === 1 ? '' : 's'} · ${planned} rows → ${names.length} ${names.length === 1 ? 'person' : 'people'}`);
```

**to**:

```js
      const names = getNames(group);
      const halves = currentHalf(group);
      const nHalf = names.filter(n => halves.has(n)).length;
      const mix = (nHalf > 0 && nHalf < names.length) ? ` (${names.length - nHalf} full · ${nHalf} half)` : (nHalf === names.length ? ' (all half)' : '');
      chips.push(`${label} · ${groupSys.length} system${groupSys.length === 1 ? '' : 's'} · ${planned} rows → ${names.length} ${names.length === 1 ? 'person' : 'people'}${mix}`);
```

- [ ] **Step 7: Run the suite — all pass**

Run: `node --test "tests/*.test.mjs" 2>&1`
Expected: 225 pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): weight-aware systemShares with half-day support

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Half-day toggle UI in Step 5

Adds the visible per-person toggle and re-renders the wizard on flip, so a checked person takes half a full share.

**Files:**
- Modify: `File_splitter.html` (Step 5 markup ~252-292, `addPerson` ~1275-1286, `peopleCard` listeners, CSS)

**Interfaces:**
- Consumes: `currentHalf(group)`, `saveHalfChecked()` (Task 2), `weightsForNames` (Task 2).
- Produces: (none new — the split flow already picks up `currentHalf`).

- [ ] **Step 1: Add the toggle styles**

In the `<style>` block, after the `.toggle-slider` rules (around line 129), add:

```css
  .person-half { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; }
  .person-half input { accent-color: var(--accent); cursor: pointer; }
  .person-half, .person-half input { font-size: 11px; color: var(--text2); font-family: var(--mono); }
```

- [ ] **Step 2: Add the toggle next to each person name**

In `addPerson(group, value)` (line 1275-1286), **change the innerHTML** from the name+remove button to also include the half-day checkbox. Replace this line:

```js
    row.innerHTML = `<span class="person-num">${num}</span><input class="person-input" type="text" placeholder="Enter name…" /><button class="rm-btn" onclick="removePerson(this)" title="Remove">×</button>`;
```

**with**:

```js
    row.innerHTML = `<span class="person-num">${num}</span><input class="person-input" type="text" placeholder="Enter name…" />
      <label class="person-half" title="Half day"><input type="checkbox" class="half-input" />½</label>
      <button class="rm-btn" onclick="removePerson(this)" title="Remove">×</button>`;
```

And after the input is created, wire the checkbox to the half-day state. Add after `const input = row.querySelector('input');`:

```js
    const half = row.querySelector('.half-input');
    half.checked = value && currentHalf(group).has(value.trim());
    half.addEventListener('change', () => {
      const name = input.value.trim();
      if (!name) { half.checked = false; return; } // unnamed rows can't carry a half flag
      const set = currentHalf(group);
      if (half.checked) set.add(name); else set.delete(name);
      saveHalfChecked();
      renderWizard();
    });
```

- [ ] **Step 3: Prune orphaned half flags on rename**

When a person's name is edited, drop any half-day flag that no longer belongs to a listed name (the flag is keyed by name string; a rename would otherwise orphan it). In the `peopleCard` `input` listener (line ~511, which calls `saveNames(); renderWizard();`), call a prune before saving:

```js
  function pruneHalf(group) {
    const names = new Set(getNames(group));
    for (const n of [...currentHalf(group)]) if (!names.has(n)) currentHalf(group).delete(n);
  }
```

and change the listener to:

```js
  peopleCard.addEventListener('input', e => {
    if (e.target.classList.contains('person-input')) { pruneHalf(e.target.closest('.people-list').dataset.group); saveNames(); renderWizard(); }
  });
```

- [ ] **Step 4: Confirm half flags restore on load, then manual verification**

`addPerson` is called by `restoreNames` with `value` set, so the `half.checked = value && currentHalf(group).has(value.trim())` line restores the flag for saved names. Verify once by hand: enter two names in a browser, tick "½" on the second, reload → the flag is back.

Then the full manual pass: upload a test workbook (or use an existing small export), go to Step 5, add two people, toggle "½" on the second. Go to Step 6 — the recap chip must read `2 people (1 full · 1 half)`. Hit "⚡ Split files" — the two downloaded files' row counts must be ~2:1 (full gets ~twice the half). Toggling off restores equal shares.

- [ ] **Step 5: Run the unit suite — still all pass**

Run: `node --test "tests/*.test.mjs" 2>&1`
Expected: 225 pass, 0 fail (no pure-logic change; UI wiring only).

- [ ] **Step 6: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): half-day toggle per person in share step

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Final verification

**Files:** (none — run-only)

- [ ] **Step 1: Full suite**

Run: `node --test "tests/*.test.mjs" 2>&1`
Expected: 231 pass, 0 fail.

- [ ] **Step 2: Smoke the loaded harness**

Run: `node -e "import('./tests/harness/load-splitter.mjs').then(m => { const s = m.loadSplitter(); console.log('sliceBounds(6,[1,0.5]) =', JSON.stringify(s.sliceBounds(6, [1, 0.5]))); })"`
Expected: `sliceBounds(6,[1,0.5]) = [[0,4],[4,6]]`

- [ ] **Step 3: Git cleanliness**

Run: `git status --short`
Expected: `tests/splitter.test.mjs` `File_splitter.html` both committed; nothing else modified.

- [ ] **Step 4: Final commit (if anything new)**

```bash
git add -A
git commit -m "chore(splitter): final half-day verification pass

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Then push the branch and open a PR (user's repo convention: `gh pr create`), with the attribution line `🤖 Generated with [Claude Code](https://claude.com/claude-code)` at the end of the PR description.