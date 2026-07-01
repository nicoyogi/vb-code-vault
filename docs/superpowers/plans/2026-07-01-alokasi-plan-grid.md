# Alokasi Plan Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Plan tab's single-day lane cockpit with a weekly `date × project` allocation grid (rows = Mon–Fri, columns = a managed project list, each cell = staff chips + a free-text note), matching how the team works in `ALOKASI PROJECT.xlsx`.

**Architecture:** All changes are inline in the single static file `alokasi-project.html` (no build step). Assignments move from one doc per person·day·project to **one doc per cell** in the existing `sgp_alokasi_schedule` collection; `sgp_alokasi_projects` is repurposed from due-date meta into the **column registry**. Pure helpers are unit-tested via the existing `node:vm` harness; UI is verified manually in the browser.

**Tech Stack:** Vanilla JS + Firebase compat SDK (Firestore `onSnapshot`), inline CSS using the Grimoire theme variables, Node's built-in test runner (`node --test`).

## Global Constraints

- Single file: all app code is the inline `<script>`/`<style>` in `alokasi-project.html`. No new files except the test file. No new dependencies, no build step.
- Tests run with `node --test` (repo `npm test`). Pure helpers must be **top-level function declarations** so the harness (`tests/harness/load-alokasi.mjs`) exposes them as `a.<name>` (it hoists declarations even if the body throws under stubs).
- All user-supplied strings interpolated into HTML go through `esc(...)`, matching existing code. Inline `onclick` handlers pass project strings via `esc(...)` exactly as the current file does.
- Reuse existing helpers verbatim: `projectSlug`, `mondayOf`, `weekDates`, `isoOf`, `isoToday`, `fmtDate`, `personLeaveOn`, `publicHolidayName`, `uniqueProjects`, `num`, `esc`, `showToast`, `currentUser`, `htPeople`, `htHolidays`, `htPublicHols`, `schedCol`, `projMetaCol`, `projMeta`, `scheduleAssignments`, `schedMonday`, `schedDept`, `setSchedDept`.
- Firestore rule blocks for `sgp_alokasi_schedule` and `sgp_alokasi_projects` already exist in `firestore.rules` (lines 71 & 74). No rule edit. If `sgp_alokasi_projects` writes fail silently, the rule was never *published* to the live project — publish via Firebase Console → Firestore → Rules.
- `personLeaveOn(holidays, personId, iso)` returns a holiday record `{personId, start, end, halfDay?, type}` (full-day when `!halfDay`), or `null`. A record covers `iso` when `start <= iso && end >= iso`.

---

### Task 1: Pure cell helpers (`cellDocId`, `cellIsEmpty`)

**Files:**
- Modify: `alokasi-project.html` — add two functions next to `projectSlug` (~line 610).
- Test: `tests/grid.test.mjs` (create).

**Interfaces:**
- Produces: `cellDocId(date, project) -> string` (`` `${date}_${projectSlug(project)}` ``); `cellIsEmpty(people, note) -> boolean` (true when `people` is empty/absent AND `note` is blank after trim).

- [ ] **Step 1: Write the failing test**

Create `tests/grid.test.mjs`:

```js
/* Unit tests for the pure grid helpers in alokasi-project.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAlokasi } from './harness/load-alokasi.mjs';

const a = loadAlokasi();

test('cellDocId: date + project slug', () => {
  assert.equal(a.cellDocId('2025-12-17', 'WMF'), '2025-12-17_wmf');
  assert.equal(a.cellDocId('2025-12-17', 'Siemens Freia'), '2025-12-17_siemens_freia');
  assert.equal(a.cellDocId('2025-12-17', 'Conti Download'), '2025-12-17_conti_download');
});

test('cellIsEmpty: empty people AND blank note', () => {
  assert.equal(a.cellIsEmpty([], ''), true);
  assert.equal(a.cellIsEmpty(undefined, '   '), true);
  assert.equal(a.cellIsEmpty(['p1'], ''), false);
  assert.equal(a.cellIsEmpty([], '161'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/grid.test.mjs`
Expected: FAIL — `a.cellDocId is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `alokasi-project.html`, immediately after the `projectSlug` function (ends ~line 610), add:

```js
/* ── Grid cell helpers (pure; unit-tested in tests/grid.test.mjs) ── */
function cellDocId(date, project){ return `${date}_${projectSlug(project)}`; }
function cellIsEmpty(people, note){ return (!people || people.length === 0) && !String(note || '').trim(); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/grid.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add alokasi-project.html tests/grid.test.mjs
git commit -m "feat(alokasi): pure cell helpers cellDocId + cellIsEmpty"
```

---

### Task 2: Column-registry helpers (`visibleColumns`, `swapOrder`)

**Files:**
- Modify: `alokasi-project.html` — add next to the cell helpers from Task 1.
- Test: `tests/grid.test.mjs` (extend).

**Interfaces:**
- Consumes: `num` (existing).
- Produces:
  - `visibleColumns(meta) -> string[]` — names of non-hidden registry entries, sorted by `order` asc then `name`.
  - `swapOrder(meta, slug, dir) -> [{slug, order}, {slug, order}]` — the two `order` updates needed to move `slug` by `dir` (`-1` up / `+1` down) among the visible columns; `[]` if the move is out of bounds.
  - Registry entry shape: `meta[slug] = { name, order, hidden }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/grid.test.mjs`:

```js
test('visibleColumns: ordered by order then name, hidden excluded', () => {
  const meta = {
    wmf:    { name: 'WMF',    order: 1 },
    krones: { name: 'KRONES', order: 0 },
    dead:   { name: 'OLD',    order: 2, hidden: true },
    noname: { order: 3 },
  };
  assert.deepEqual(a.visibleColumns(meta), ['KRONES', 'WMF']);
  assert.deepEqual(a.visibleColumns({}), []);
});

test('swapOrder: swaps order with the neighbour in move direction', () => {
  const meta = { krones: { name: 'KRONES', order: 0 }, wmf: { name: 'WMF', order: 1 } };
  assert.deepEqual(a.swapOrder(meta, 'wmf', -1), [{ slug: 'wmf', order: 0 }, { slug: 'krones', order: 1 }]);
  assert.deepEqual(a.swapOrder(meta, 'krones', 1), [{ slug: 'krones', order: 1 }, { slug: 'wmf', order: 0 }]);
  assert.deepEqual(a.swapOrder(meta, 'krones', -1), []); // already first
  assert.deepEqual(a.swapOrder(meta, 'wmf', 1), []);     // already last
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/grid.test.mjs`
Expected: FAIL — `a.visibleColumns is not a function`.

- [ ] **Step 3: Write minimal implementation**

After the Task 1 helpers, add:

```js
/* Ordered names of non-hidden registry columns. */
function visibleColumns(meta){
  return Object.values(meta || {})
    .filter(m => m && m.name && !m.hidden)
    .sort((x, y) => (num(x.order) - num(y.order)) || String(x.name).localeCompare(String(y.name)))
    .map(m => m.name);
}
/* Order updates to move `slug` by dir (-1 up / +1 down) among visible columns; [] if out of bounds. */
function swapOrder(meta, slug, dir){
  const vis = Object.entries(meta || {})
    .filter(([, m]) => m && m.name && !m.hidden)
    .sort((a, b) => (num(a[1].order) - num(b[1].order)) || String(a[1].name).localeCompare(String(b[1].name)));
  const i = vis.findIndex(([s]) => s === slug);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= vis.length) return [];
  const [sa, ma] = vis[i], [sb, mb] = vis[j];
  return [{ slug: sa, order: num(mb.order) }, { slug: sb, order: num(ma.order) }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/grid.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add alokasi-project.html tests/grid.test.mjs
git commit -m "feat(alokasi): column-registry helpers visibleColumns + swapOrder"
```

---

### Task 3: Cell writer (`setCell`); remove per-person assignment writers

**Files:**
- Modify: `alokasi-project.html` — replace `schedDocId` (line 707) and `setAssignment` (lines 752–764) with `setCell`; delete cockpit-only writers `assignControl`, `addAssign`, `removeAssign`, `dayActual`, `logFromPlan` (lines 1082–1115).
- Test: `tests/grid.test.mjs` (extend — existence + call safety under stubs).

**Interfaces:**
- Consumes: `cellDocId`, `cellIsEmpty` (Task 1), `schedCol`, `currentUser`, `firebase`, `showToast` (existing).
- Produces: `async setCell(date, project, personIds, note)` — deletes the cell doc when `cellIsEmpty(personIds, note)`, else upserts `{ date, project, people, note, by, ts }` with `{merge:true}`. Never throws (errors surface via `showToast`).

- [ ] **Step 1: Write the failing test**

Append to `tests/grid.test.mjs`:

```js
test('setCell: defined and callable without throwing (stubbed Firestore)', async () => {
  assert.equal(typeof a.setCell, 'function');
  await a.setCell('2025-12-17', 'WMF', ['p1', 'p2'], '161'); // upsert path
  await a.setCell('2025-12-17', 'WMF', [], '');              // delete path
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/grid.test.mjs`
Expected: FAIL — `a.setCell is not a function`.

- [ ] **Step 3a: Replace `schedDocId` + `setAssignment` with `setCell`**

Delete line 707 (`function schedDocId(...)`) and the whole `setAssignment` function (lines 752–764). In their place (keep it near `startScheduleListener`), add:

```js
/* Upsert a cell (date × project) = a set of people + a free-text note.
   Empty people AND blank note deletes the cell doc. */
async function setCell(date, project, personIds, note){
  const id = cellDocId(date, project);
  project = (project || '').trim();
  note = (note || '').trim();
  const people = (personIds || []).filter(Boolean);
  try {
    if (cellIsEmpty(people, note)){ await schedCol.doc(id).delete(); return; }
    await schedCol.doc(id).set({
      date, project, people, note,
      by: currentUser ? currentUser.name : '',
      ts: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e){ showToast('Could not save cell: ' + e.message, true); }
}
```

- [ ] **Step 3b: Delete the cockpit-only writers**

Delete these functions entirely (lines ~1082–1115): `assignControl`, `addAssign`, `removeAssign`, `dayActual`, `logFromPlan`. They are only called from `renderCockpit`, which is removed in Task 4.

Verify none are referenced elsewhere:

Run: `grep -nE "schedDocId|setAssignment|assignControl|addAssign|removeAssign|dayActual|logFromPlan" alokasi-project.html`
Expected: no matches (all definitions and call sites gone). If `renderCockpit` still references them, that is expected until Task 4 — proceed; Task 4 deletes `renderCockpit`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/grid.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add alokasi-project.html tests/grid.test.mjs
git commit -m "feat(alokasi): setCell one-doc-per-cell writer; drop per-person writers"
```

---

### Task 4: Render the grid (`renderGrid`); delete the cockpit + dead lens code

**Files:**
- Modify: `alokasi-project.html`:
  - Delete cockpit renders/nav: `renderCockpit` (1117–1216), `renderWeekOverview` (1219–1250), `planJump` (1218), `planNav`/`planToday`/`setPlanMode` (1056–1058), `planToolbar` (1060–1079), `schedWeek`/`schedThisWeek` (1049–1050), and `SCHED_LEAVE_ICON` (1053).
  - Delete dead lens helpers: `throughputByPerson`, `capacityFor`, `projectBacklog`, `personLoadByDay`, `loadTier`, `riskTier`, and `setProjectDue` (749).
  - Delete state no longer used: `planMode` (522), `schedDay` (523). Keep `schedMonday`, `schedDept`.
  - Replace `renderPlan` (1055) body with `renderGrid()`.
  - Add `gridToolbar`, `gridWeek`, `gridThisWeek`, `renderGrid`.
  - Add grid CSS after the `.ck-day.pubhol` rule (~line 309).
- Modify: `tests/cockpit.test.mjs` — delete tests for the removed lens helpers.

**Interfaces:**
- Consumes: `visibleColumns` (Task 2), `cellDocId` (Task 1), `weekDates`, `publicHolidayName`, `fmtDate`, `esc`, `htPeople`, `htPublicHols`, `scheduleAssignments`, `schedMonday`, `schedDept`, `htLoaded`, `records`, `openCellEditor`/`openColManager`/`seedColumnsFromRecords` (defined in Tasks 5–6; wired here as inline handlers).
- Produces: `renderGrid()` renders into `#view-plan`; `gridWeek(delta)`, `gridThisWeek()` navigate the visible week.

- [ ] **Step 1: Delete the dead lens tests first (keep suite green after code removal)**

In `tests/cockpit.test.mjs`, delete the tests named:
`projectBacklog: ...`, both `throughputByPerson: ...`, both `capacityFor: ...`, `personLoadByDay + loadTier`, and `riskTier: ...`.
Keep: `projectSlug: ...`, `ageDays: ...`, `workingDaysBetween: ...`.

- [ ] **Step 2: Delete cockpit render, nav, and dead lens helpers**

Remove the functions/state listed in **Files** above. Keep `ageDays`, `workingDaysBetween`, `projectSlug` (still referenced elsewhere / by Analyze). After deletion, replace `renderPlan` with:

```js
function renderPlan(){ renderGrid(); }
```

- [ ] **Step 3: Add grid navigation + toolbar + renderer**

Add (near where `renderPlan` lives):

```js
function gridWeek(delta){ const d = new Date(schedMonday + 'T00:00:00'); d.setDate(d.getDate() + delta * 7); schedMonday = isoOf(d); render(); }
function gridThisWeek(){ schedMonday = mondayOf(isoToday()); render(); }

function gridToolbar(label){
  const depts = [...new Set(htPeople.map(p => p.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return `<div class="sched-toolbar">
    <div class="seg">
      <button class="seg-btn" onclick="gridWeek(-1)">‹</button>
      <button class="seg-btn" onclick="gridThisWeek()">This week</button>
      <button class="seg-btn" onclick="gridWeek(1)">›</button>
    </div>
    <span class="sched-week">${esc(label)}</span>
    <div class="spacer"></div>
    <select onchange="setSchedDept(this.value)">
      <option value="">All depts</option>
      ${depts.map(d => `<option value="${esc(d)}"${d === schedDept ? ' selected' : ''}>${esc(d)}</option>`).join('')}
    </select>
    <button class="seg-btn" onclick="openColManager()">Manage columns</button>
  </div>`;
}

function renderGrid(){
  const host = document.getElementById('view-plan');
  if (!htLoaded){ host.innerHTML = `<div class="panel"><div class="empty"><div class="empty-icon">⏳</div><div>Loading roster…</div></div></div>`; return; }
  const dates = weekDates(schedMonday);
  const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const cols = visibleColumns(projMeta);
  const rangeLabel = `${fmtDate(dates[0])} – ${fmtDate(dates[4])}`;
  if (!cols.length){
    const seed = records.length ? ` or <button class="btn-sm" onclick="seedColumnsFromRecords()">seed from records</button>` : '';
    host.innerHTML = gridToolbar(rangeLabel) +
      `<div class="panel"><div class="empty"><div class="empty-icon">🗂️</div><div>No project columns yet.</div><div class="empty-sub"><button class="btn-sm" onclick="openColManager()">Manage columns</button> to add projects${seed}.</div></div></div>`;
    return;
  }
  const nameFor = id => (htPeople.find(x => x.id === id) || {}).name || id;
  const head = `<tr><th class="gc-daycol">Day</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = dates.map((iso, i) => {
    const ph = publicHolidayName(htPublicHols, iso);
    const cells = cols.map(c => {
      const cell = scheduleAssignments[cellDocId(iso, c)];
      const chips = ((cell && cell.people) || []).map(pid => `<span class="gc-chip">${esc(nameFor(pid))}</span>`).join('');
      const note = cell && cell.note ? `<span class="gc-note">${esc(cell.note)}</span>` : '';
      const inner = (chips || note) ? `${chips} ${note}` : `<span class="gc-empty">+</span>`;
      return `<td class="gc-cell" onclick="openCellEditor('${iso}','${esc(c)}')">${inner}</td>`;
    }).join('');
    const dayCell = `<td class="gc-daycol"><b>${WEEKDAY[i]}</b><br><span class="gc-date">${esc(fmtDate(iso))}</span>${ph ? `<br><span class="gc-ph">${esc(ph)}</span>` : ''}</td>`;
    return `<tr class="${ph ? 'pubhol' : ''}">${dayCell}${cells}</tr>`;
  }).join('');
  host.innerHTML = gridToolbar(rangeLabel) + `<div class="gc-wrap"><table class="gc-table">${head}${body}</table></div>`;
}
```

- [ ] **Step 4: Add grid CSS**

After the `.ck-day.pubhol` rule (~line 309, before `</style>`), add:

```css
    .gc-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius-lg); }
    .gc-table { border-collapse:collapse; font-size:12px; min-width:100%; }
    .gc-table th, .gc-table td { border-bottom:1px solid var(--border); border-right:1px solid var(--border); padding:6px 8px; text-align:left; vertical-align:top; }
    .gc-table th { background:var(--surface2); font-family:var(--grotesk); font-weight:700; position:sticky; top:0; z-index:1; }
    .gc-daycol { position:sticky; left:0; background:var(--surface); z-index:2; white-space:nowrap; min-width:88px; }
    .gc-table th.gc-daycol { z-index:3; }
    .gc-date { font-family:var(--ibm-mono); font-size:10px; color:var(--text3); }
    .gc-ph { font-family:var(--ibm-mono); font-size:10px; color:var(--warn); }
    .gc-cell { cursor:pointer; min-width:120px; }
    .gc-cell:hover { background:var(--surface2); }
    .gc-chip { display:inline-block; background:var(--accent-light); color:var(--accent); border-radius:6px; padding:1px 7px; margin:1px 3px 1px 0; }
    .gc-note { color:var(--text3); font-family:var(--ibm-mono); font-size:10.5px; }
    .gc-empty { color:var(--text3); }
    .gc-table tr.pubhol .gc-cell, .gc-table tr.pubhol .gc-daycol { background:var(--accent-light); }
    .gc-ed-overlay { position:fixed; inset:0; background:rgba(0,0,0,.35); display:none; align-items:center; justify-content:center; z-index:1000; }
    .gc-ed-panel { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); box-shadow:var(--shadow); padding:1rem 1.1rem; width:min(420px,92vw); max-height:86vh; overflow:auto; }
    .gc-ed-head { font-family:var(--grotesk); font-weight:700; margin-bottom:.6rem; }
    .gc-ed-people { display:flex; flex-wrap:wrap; gap:6px 14px; margin-bottom:.7rem; }
    .gc-ed-person { display:flex; gap:6px; align-items:center; font-size:12.5px; }
    .gc-ed-person.off { color:var(--text3); }
    .gc-ed-note-lbl { display:block; font-family:var(--ibm-mono); font-size:10.5px; color:var(--text2); margin-bottom:3px; }
    #gc-ed-note { width:100%; margin-bottom:.7rem; }
    .gc-ed-actions { display:flex; gap:8px; }
    .gc-col-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:4px 0; border-bottom:1px solid var(--border); }
    .gc-col-row.off .gc-col-name { color:var(--text3); text-decoration:line-through; }
    .gc-col-add { display:flex; gap:8px; margin-top:.7rem; }
    #gc-col-new { flex:1; }
```

- [ ] **Step 5: Run the full suite; verify grid renders in the browser**

Run: `node --test`
Expected: PASS — grid + surviving cockpit tests green, no `renderCockpit`/lens references. If a test references a deleted helper, remove that test (Step 1 miss).

Then open `alokasi-project.html` in a browser, sign in, go to **Plan**. Expected: a week grid (Day column + project columns) or the "No project columns yet" empty state. `‹ This week ›` navigates weeks; a public-holiday row is tinted. (Cells are not yet editable — Task 5.)

- [ ] **Step 6: Commit**

```bash
git add alokasi-project.html tests/cockpit.test.mjs
git commit -m "feat(alokasi): Plan tab renders weekly allocation grid; remove lane cockpit"
```

---

### Task 5: Cell editor popover (`cellEditorHtml`, `openCellEditor`, `saveCellEditor`, `clearCellEditor`, `closeCellEditor`)

**Files:**
- Modify: `alokasi-project.html` — add the editor functions near `renderGrid`; add module-level `let cellEditing = null;` beside the other Plan state.
- Test: `tests/grid.test.mjs` (extend — `cellEditorHtml` is pure).

**Interfaces:**
- Consumes: `setCell` (Task 3), `cellDocId` (Task 1), `personLeaveOn`, `htHolidays`, `htPeople`, `schedDept`, `fmtDate`, `esc`, `scheduleAssignments`.
- Produces:
  - `cellEditorHtml(date, project, cell, ppl, holidays) -> string` — a checkbox per person (checked when in `cell.people`, `disabled` + `.off` when on full-day leave that date), a note input pre-filled from `cell.note`, and Save / Clear / Cancel buttons.
  - `openCellEditor(date, project)`, `saveCellEditor()`, `clearCellEditor()`, `closeCellEditor()`.

- [ ] **Step 1: Write the failing test**

Append to `tests/grid.test.mjs`:

```js
test('cellEditorHtml: checks assigned people, disables full-day leave, prefills note', () => {
  const ppl = [{ id: 'p1', name: 'Raka' }, { id: 'p2', name: 'Lia' }];
  const cell = { people: ['p1'], note: '161' };
  const holidays = [{ personId: 'p2', start: '2025-12-17', end: '2025-12-17', type: 'vacation' }];
  const html = a.cellEditorHtml('2025-12-17', 'WMF', cell, ppl, holidays);
  assert.match(html, /value="p1"[^>]*checked/);
  assert.match(html, /value="p2"[^>]*disabled/);
  assert.match(html, /value="161"/);
  assert.ok(!/value="p1"[^>]*disabled/.test(html)); // p1 not on leave
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/grid.test.mjs`
Expected: FAIL — `a.cellEditorHtml is not a function`.

- [ ] **Step 3: Implement the editor**

Add `let cellEditing = null;` next to the Plan state (near `schedMonday`). Then add:

```js
function cellEditorHtml(date, project, cell, ppl, holidays){
  const chosen = new Set((cell && cell.people) || []);
  const rows = ppl.map(p => {
    const lv = personLeaveOn(holidays, p.id, date);
    const off = !!(lv && !lv.halfDay);
    return `<label class="gc-ed-person${off ? ' off' : ''}">
      <input type="checkbox" value="${esc(p.id)}"${chosen.has(p.id) ? ' checked' : ''}${off ? ' disabled' : ''}>
      ${esc(p.name)}${off ? ` <span class="gc-ph">(${esc(lv.type || 'leave')})</span>` : ''}
    </label>`;
  }).join('');
  const emptyMsg = `<span class="gc-note">No roster people${schedDept ? ' in this dept' : ''}.</span>`;
  return `<div class="gc-ed-head">${esc(project)} · ${esc(fmtDate(date))}</div>
    <div class="gc-ed-people">${rows || emptyMsg}</div>
    <label class="gc-ed-note-lbl" for="gc-ed-note">Note</label>
    <input id="gc-ed-note" type="text" value="${esc((cell && cell.note) || '')}" placeholder="(checking) · 161 · anything">
    <div class="gc-ed-actions">
      <button class="btn-sm" onclick="saveCellEditor()">Save</button>
      <button class="btn-sm" onclick="clearCellEditor()">Clear cell</button>
      <button class="btn-sm" onclick="closeCellEditor()">Cancel</button>
    </div>`;
}
function gridOverlay(){
  let ov = document.getElementById('gc-ed-overlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'gc-ed-overlay';
    ov.className = 'gc-ed-overlay';
    ov.onclick = e => { if (e.target === ov) closeCellEditor(); };
    document.body.appendChild(ov);
  }
  return ov;
}
function openCellEditor(date, project){
  cellEditing = { date, project };
  const ppl = htPeople.filter(p => !schedDept || p.dept === schedDept);
  const cell = scheduleAssignments[cellDocId(date, project)];
  const ov = gridOverlay();
  ov.innerHTML = `<div class="gc-ed-panel">${cellEditorHtml(date, project, cell, ppl, htHolidays)}</div>`;
  ov.style.display = 'flex';
}
function closeCellEditor(){ cellEditing = null; const ov = document.getElementById('gc-ed-overlay'); if (ov) ov.style.display = 'none'; }
function saveCellEditor(){
  if (!cellEditing) return;
  const ov = document.getElementById('gc-ed-overlay');
  const ids = [...ov.querySelectorAll('.gc-ed-people input[type=checkbox]:checked')].map(c => c.value);
  const note = document.getElementById('gc-ed-note').value;
  setCell(cellEditing.date, cellEditing.project, ids, note);
  closeCellEditor();
}
function clearCellEditor(){
  if (!cellEditing) return;
  setCell(cellEditing.date, cellEditing.project, [], '');
  closeCellEditor();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/grid.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify in the browser**

Open the Plan grid, click a cell. Expected: overlay opens with roster checkboxes (people on full-day leave that date greyed + disabled) and a note field. Check two people, type `161`, Save → chips + note appear in the cell and persist after reload (live via `onSnapshot`). Clear cell → cell empties.

- [ ] **Step 6: Commit**

```bash
git add alokasi-project.html tests/grid.test.mjs
git commit -m "feat(alokasi): cell editor popover (staff checklist + note)"
```

---

### Task 6: Column manager (`addColumn`, `renameColumn`, `hideColumn`, `showColumn`, `moveColumn`, `seedColumnsFromRecords`, `openColManager`)

**Files:**
- Modify: `alokasi-project.html` — add column-registry writers + the manager overlay near `renderGrid`.
- Test: none new (logic covered by `swapOrder` in Task 2; writers are Firestore-bound). Verified in the browser.

**Interfaces:**
- Consumes: `projMetaCol`, `projMeta`, `projectSlug`, `uniqueProjects`, `swapOrder` (Task 2), `num`, `esc`, `showToast`, `records`, `gridOverlay`/`closeCellEditor` (Task 5).
- Produces: `openColManager()` opens the manager overlay; writers upsert/delete-field on `sgp_alokasi_projects` docs keyed by `projectSlug(name)`.

- [ ] **Step 1: Implement the registry writers**

Add near `renderGrid`:

```js
async function addColumn(name){
  name = (name || '').trim(); if (!name) return;
  const id = projectSlug(name);
  const maxOrder = Object.values(projMeta).reduce((m, x) => Math.max(m, num(x.order)), -1);
  try { await projMetaCol.doc(id).set({ name, order: maxOrder + 1, hidden: false }, { merge: true }); }
  catch (e){ showToast('Could not add column: ' + e.message + ' (publish Firestore rules?)', true); }
}
async function renameColumn(slug, name){
  name = (name || '').trim(); if (!name) return;
  try { await projMetaCol.doc(slug).set({ name }, { merge: true }); }
  catch (e){ showToast('Could not rename column: ' + e.message, true); }
}
async function hideColumn(slug){ try { await projMetaCol.doc(slug).set({ hidden: true }, { merge: true }); } catch (e){ showToast('Could not hide column: ' + e.message, true); } }
async function showColumn(slug){ try { await projMetaCol.doc(slug).set({ hidden: false }, { merge: true }); } catch (e){ showToast('Could not show column: ' + e.message, true); } }
async function moveColumn(slug, dir){
  const ups = swapOrder(projMeta, slug, dir);
  try { for (const u of ups) await projMetaCol.doc(u.slug).set({ order: u.order }, { merge: true }); }
  catch (e){ showToast('Could not reorder column: ' + e.message, true); }
}
async function seedColumnsFromRecords(){
  const names = uniqueProjects(records).filter(Boolean);
  try {
    for (let i = 0; i < names.length; i++) await projMetaCol.doc(projectSlug(names[i])).set({ name: names[i], order: i, hidden: false }, { merge: true });
    showToast(names.length + ' columns added.');
  } catch (e){ showToast('Could not seed columns: ' + e.message, true); }
}
```

- [ ] **Step 2: Implement the manager overlay**

```js
function colManagerHtml(){
  const all = Object.entries(projMeta)
    .filter(([, m]) => m && m.name)
    .sort((a, b) => (num(a[1].order) - num(b[1].order)) || String(a[1].name).localeCompare(String(b[1].name)));
  const rows = all.map(([slug, m]) => `<div class="gc-col-row${m.hidden ? ' off' : ''}">
    <span class="gc-col-name">${esc(m.name)}</span>
    <span>
      <button class="btn-sm" onclick="moveColumn('${esc(slug)}',-1).then(openColManager)" title="up">↑</button>
      <button class="btn-sm" onclick="moveColumn('${esc(slug)}',1).then(openColManager)" title="down">↓</button>
      <button class="btn-sm" onclick="renameColPrompt('${esc(slug)}')" title="rename">✎</button>
      <button class="btn-sm" onclick="${m.hidden ? `showColumn('${esc(slug)}')` : `hideColumn('${esc(slug)}')`}.then(openColManager)">${m.hidden ? 'show' : 'hide'}</button>
    </span>
  </div>`).join('');
  const seed = records.length ? `<div style="margin-top:.6rem"><button class="btn-sm" onclick="seedColumnsFromRecords().then(openColManager)">Seed from records</button></div>` : '';
  return `<div class="gc-ed-head">Manage columns</div>
    <div>${rows || '<span class="gc-note">No columns yet.</span>'}</div>
    <div class="gc-col-add">
      <input id="gc-col-new" type="text" placeholder="New project name">
      <button class="btn-sm" onclick="addColFromInput()">Add</button>
    </div>${seed}
    <div class="gc-ed-actions" style="margin-top:.8rem"><button class="btn-sm" onclick="closeCellEditor()">Done</button></div>`;
}
function openColManager(){
  const ov = gridOverlay();
  ov.innerHTML = `<div class="gc-ed-panel">${colManagerHtml()}</div>`;
  ov.style.display = 'flex';
}
function addColFromInput(){ const el = document.getElementById('gc-col-new'); addColumn(el.value).then(openColManager); }
function renameColPrompt(slug){ const cur = (projMeta[slug] || {}).name || ''; const v = prompt('Rename column', cur); if (v != null) renameColumn(slug, v).then(openColManager); }
```

`// ponytail: the manager overlay is a plain DOM node outside render(); each action re-opens it (.then(openColManager)) to refresh — no reactive binding needed for a rarely-used admin panel.`

- [ ] **Step 3: Run the full suite**

Run: `node --test`
Expected: PASS (all grid + surviving cockpit tests). No behaviour change to the pure suite; this task is Firestore-bound UI.

- [ ] **Step 4: Verify in the browser**

On Plan, click **Manage columns**. Expected: add a project (appears as a new column), reorder with ↑/↓, hide one (drops from the grid, shows struck-through in the manager), rename it, and — from an empty registry — **Seed from records** populates columns from existing Records projects.

- [ ] **Step 5: Commit**

```bash
git add alokasi-project.html
git commit -m "feat(alokasi): manage columns — add/rename/reorder/hide + seed from records"
```

---

## Self-Review

**Spec coverage**
- Grid replaces Plan cockpit → Task 4 (delete cockpit, add `renderGrid`, `renderPlan` → grid).
- Cell = staff picker + free-text note → Task 5 (`cellEditorHtml`, checkboxes + note).
- Allocation only, no quantity grid → nothing built for quantity; `qty` writer removed (Task 3).
- One week at a time (Mon–Fri) → `renderGrid` uses `weekDates`; `gridWeek`/`gridThisWeek`.
- Managed column list (add/rename/reorder/hide) → Task 6; ordering via `swapOrder` (Task 2), display via `visibleColumns` (Task 2).
- One doc per cell `${date}_${projectSlug}` → Task 1 (`cellDocId`) + Task 3 (`setCell`).
- Delete-on-empty → `cellIsEmpty` (Task 1) used by `setCell` (Task 3) and `clearCellEditor` (Task 5).
- Keep leave/holiday awareness → `renderGrid` shades public-holiday rows; `cellEditorHtml` disables full-day-leave people.
- Seed from records (convenience, not Excel import) → `seedColumnsFromRecords` (Task 6).
- No rule change, no new deps, single file → held throughout; Global Constraints.
- Records / Analyze / `#people` untouched → no task edits them; `render()` dispatch unchanged except the `plan` branch.

**Placeholder scan:** none — every code step has full code; every command has expected output.

**Type consistency:** `cellDocId`, `cellIsEmpty`, `visibleColumns`, `swapOrder` signatures are identical across the tasks that define and consume them. Registry entry shape `{name, order, hidden}` is consistent in `visibleColumns`, `swapOrder`, `addColumn`, `seedColumnsFromRecords`, `colManagerHtml`. Cell doc shape `{date, project, people, note, by, ts}` is written by `setCell` and read by `renderGrid`/`cellEditorHtml` (`cell.people`, `cell.note`). `setCell(date, project, personIds, note)` call sites (`saveCellEditor`, `clearCellEditor`) match.

**Forward-reference note:** Task 4's `renderGrid` wires inline handlers `openCellEditor` / `openColManager` / `seedColumnsFromRecords` that are defined in Tasks 5–6. This is safe: they are only invoked on user click, which cannot happen until the later tasks land. The suite stays green between tasks because the handlers are strings until clicked.
