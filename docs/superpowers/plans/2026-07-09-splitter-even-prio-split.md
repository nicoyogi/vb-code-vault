# File Splitter — Even PRIO Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRIO rows are dealt evenly (±1) across all people by splitting each system's PRIO and non-PRIO rows as two independent pools through the existing doc-band machinery.

**Architecture:** `File_splitter.html` is a single-file browser app; pure helpers are unit-tested in Node via a vm harness (`tests/harness/load-splitter.mjs`). A new pure helper `systemShares` extracts `splitFile`'s inline pool/bounds bookkeeping and adds the two-pool partition; `splitFile` then indexes into the returned shares instead of slicing bounds itself.

**Tech Stack:** Vanilla JS in one HTML file, xlsx-js-style in the browser, `node:test` + `node:vm` for unit tests.

**Spec:** `docs/superpowers/specs/2026-07-09-splitter-even-prio-split-design.md`

## Global Constraints

- Node 24: run tests as `node --test "tests/splitter.test.mjs"` (quoted path; bare `node --test tests/` fails on this Node).
- All `File_splitter.html` changes go in the inline attribute-less `<script>` block (the one containing `fileSplitter.names`) — that is what the vm harness loads.
- Row shape: `[vendor, supplier, reference, doc, notes[], overdue]` — doc at index 3, overdue at index 5.
- Guarantees (from spec): PRIO rows per share ±1 before doc-run nudges; every row lands in exactly one share; one document stays in one share within each pool; zero PRIO rows degrades to exactly today's single-pool behavior; shuffle OFF gives deterministic in-order slices per pool with remainder to the front.
- Each pool's band→person assignment shuffles independently when shuffle is ON.
- No new UI, no new toggles.
- Commit after each task; never push (the controller pushes).

---

### Task 1: `systemShares` pure helper

**Files:**
- Modify: `File_splitter.html` (insert after `snapBoundsToDocRuns`, which ends near line 960, directly before `async function splitFile()`)
- Test: `tests/splitter.test.mjs` (append)

**Interfaces:**
- Consumes: existing helpers `docNumDesc`, `sliceBounds`, `snapBoundsToDocRuns`, `shuffleArray` (all top-level functions in the same script block).
- Produces: `systemShares(rows, parts, doShuffle, isPrioRow)` → array of exactly `parts` row-arrays. `rows`: projected 6-element rows; `parts`: integer ≥ 1; `doShuffle`: boolean; `isPrioRow`: `(row) => boolean`. Task 2 calls it from `splitFile`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/splitter.test.mjs`:

```js
test('systemShares: PRIO rows split evenly (±1) across shares, all rows covered once', () => {
  // 5 PRIO + 7 rest rows -> 3 shares
  const row = (doc, isP) => ['V', 'S', 'R', doc, [], isP ? new Date(2026, 6, 6) : ''];
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row('P' + i, true));
  for (let i = 0; i < 7; i++) rows.push(row('R' + i, false));
  const isPrioRow = r => !!r[5];
  for (const doShuffle of [false, true]) {
    const shares = s.systemShares(rows, 3, doShuffle, isPrioRow);
    assert.equal(shares.length, 3);
    const prioCounts = shares.map(sh => sh.filter(isPrioRow).length);
    assert.equal(Math.max(...prioCounts) - Math.min(...prioCounts) <= 1, true,
      `prio counts ±1, got ${prioCounts} (shuffle=${doShuffle})`);
    assert.equal(prioCounts.reduce((a, b) => a + b, 0), 5);
    // every input row appears exactly once across all shares
    const docs = shares.flat().map(r => r[3]).sort();
    assert.deepEqual(plain(docs), plain(rows.map(r => r[3]).sort()));
  }
});

test('systemShares: zero PRIO rows + shuffle off -> plain in-order single-pool split', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  const rows = [row('5'), row('4'), row('3'), row('2'), row('1')];
  const shares = s.systemShares(rows, 2, false, () => false);
  // remainder to the front, original order preserved — today's no-shuffle behavior
  assert.deepEqual(plain(shares.map(sh => sh.map(r => r[3]))), [['5', '4', '3'], ['2', '1']]);
});

test('systemShares: doc runs stay intact within a pool when shuffled', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  // doc-sorted pool ['9','9','9','8']: naive cut at 2 lands inside the 9-run
  const rows = [row('9'), row('9'), row('9'), row('8')];
  const shares = s.systemShares(rows, 2, true, () => false);
  const withNine = shares.filter(sh => sh.some(r => r[3] === '9'));
  assert.equal(withNine.length, 1);                              // all '9' rows in one share
  assert.equal(withNine[0].filter(r => r[3] === '9').length, 3); // none lost
});

test('systemShares: more shares than rows -> empty shares, nothing lost', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  const shares = s.systemShares([row('1')], 3, false, () => false);
  assert.deepEqual(plain(shares.map(sh => sh.length)), [1, 0, 0]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "tests/splitter.test.mjs"`
Expected: the four new tests FAIL with `s.systemShares is not a function`; all pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `File_splitter.html`, directly after the closing brace of `snapBoundsToDocRuns` (before `async function splitFile()`):

```js
  // Split one system's filtered rows into `parts` shares. PRIO rows and the
  // rest split as two independent pools so urgent work lands evenly (±1 per
  // share); each pool runs through the doc-band machinery — doc-sorted,
  // balanced contiguous bands, cuts nudged off equal-doc runs, band→person
  // assignment shuffled per pool (shuffle ON) or in-order slices (OFF).
  // With no PRIO rows this is exactly the single-pool split.
  function systemShares(rows, parts, doShuffle, isPrioRow) {
    const pools = [[], []];
    for (const r of rows) pools[isPrioRow(r) ? 0 : 1].push(r);
    const shares = Array.from({ length: parts }, () => []);
    for (const p of pools) {
      if (p.length === 0) continue;
      const pool = doShuffle ? [...p].sort(docNumDesc) : p;
      const b = sliceBounds(pool.length, parts);
      const bounds = doShuffle ? shuffleArray(snapBoundsToDocRuns(b, pool)) : b;
      for (let i = 0; i < parts; i++) shares[i].push(...pool.slice(bounds[i][0], bounds[i][1]));
    }
    return shares;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/splitter.test.mjs"`
Expected: ALL tests PASS.

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): systemShares — two-pool split deals PRIO rows evenly"
```

---

### Task 2: wire `systemShares` into `splitFile`

**Files:**
- Modify: `File_splitter.html` (`splitFile`, the job loop near lines 1000-1027)
- Test: existing suite (no new tests; this is wiring of a fully tested helper)

**Interfaces:**
- Consumes: `systemShares(rows, parts, doShuffle, isPrioRow)` from Task 1; existing `splitRows`, `isPrio`, `prioColumnOn`, module-level `prio`; `prioOn` and `today`, already defined in `splitFile`.
- Produces: nothing new — behavior change only.

- [ ] **Step 1: Replace the pool/bounds block**

In `splitFile`, replace this block (the comment plus the `pool`/`bounds` construction at the top of the `for (const job of jobs)` loop):

```js
        // Filter each system per its group policy. Shuffle keeps document
        // numbers together: the pool is doc-sorted and cut into contiguous
        // balanced bands, and only the band→person assignment is random —
        // each share covers a compact doc-number range instead of a scatter,
        // and the +1 remainder rows land on random people instead of the
        // first-listed ones. Band edges are nudged off runs of equal doc
        // numbers, so one document never lands in two shares.
        const pool = {};
        const bounds = {};
        for (const sys of job.systems) {
          const dataRows = splitRows(sys, keepNotes, skipBlanks);
          pool[sys.name] = doShuffle ? [...dataRows].sort(docNumDesc) : dataRows;
          const b = sliceBounds(dataRows.length, job.names.length);
          bounds[sys.name] = doShuffle ? shuffleArray(snapBoundsToDocRuns(b, pool[sys.name])) : b;
        }
```

with:

```js
        // Filter each system per its group policy, then deal shares via
        // systemShares: PRIO rows and the rest split as two independent
        // pools, so urgent work lands evenly instead of clustering in one
        // person's doc band.
        const isPrioRow = prioOn ? (r => isPrio(r, prio && prio.docs, today)) : (() => false);
        const shares = {};
        for (const sys of job.systems) {
          shares[sys.name] = systemShares(splitRows(sys, keepNotes, skipBlanks), job.names.length, doShuffle, isPrioRow);
        }
```

- [ ] **Step 2: Replace the per-person chunk extraction**

Inside the `for (const sys of job.systems)` loop of the per-person (`for (let i = 0; ...)`) loop, replace:

```js
            const rows = pool[sys.name];
            const [start, end] = bounds[sys.name][i];
            const chunk = rows.slice(start, end);
            chunk.sort(outputRowOrder); // forwarder A→Z, doc Z→A within; the shared pool stays untouched
```

with:

```js
            const chunk = shares[sys.name][i];
            chunk.sort(outputRowOrder); // forwarder A→Z, doc Z→A within; each share is its own array
```

(`systemShares` builds each share as a fresh array, so the in-place sort is safe.)

- [ ] **Step 3: Run the full suite**

Run: `node --test "tests/*.test.mjs"`
Expected: ALL tests PASS (the suite spans several apps; the splitter file must stay loadable by the harness).

- [ ] **Step 4: E2E sanity check against the real example file**

Extend the throwaway scratchpad script pattern (NOT committed) to deal Book1's rows over 4 people and print per-share PRIO counts:

```js
// scratchpad/verify-book1-shares.mjs — throwaway; needs scratchpad/xlsx.min.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadSplitter } from 'file:///D:/vb-code-vault/tests/harness/load-splitter.mjs';

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
const isPrioRow = r => s.isPrio(r, null, today);
for (const e of res.entries) {
  const shares = s.systemShares(e.rows, 4, true, isPrioRow);
  console.log(`${e.base}/${e.group}:`, shares.map(sh => `${sh.filter(isPrioRow).length}p/${sh.length}t`).join(' '));
}
```

Run: `node <scratchpad>/verify-book1-shares.mjs`
Expected: one line with four shares whose PRIO counts are `4p 4p 4p 3p` in some order (15 PRIO rows over 4 people, ±1).

- [ ] **Step 5: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): deal PRIO rows evenly across people via systemShares"
```
