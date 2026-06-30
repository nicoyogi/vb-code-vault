# Project Allocation "Schedule" Roster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a forward-looking person × weekday roster tab to `alokasi-project.html` that pulls leave from the Holiday Tracker so people who are away can't be scheduled.

**Architecture:** All UI/logic is inline JS inside `alokasi-project.html` (the file's existing pattern — no external module, no refactor). A new Firestore collection `sgp_alokasi_schedule` stores one doc per filled cell, subscribed live. Holiday-tracker data (`wmf_holiday_people`, `wmf_holidays`, `wmf_public_holidays`) is read once per session from the same Firebase project. Pure date/leave-classification helpers are unit-tested in Node by extracting the inline `<script>` into a `vm` (mirroring `tests/harness/load-engine.mjs`).

**Tech Stack:** Vanilla browser JS, Firebase Firestore compat SDK (already loaded), Node built-in test runner (`node --test`), `node:vm`.

## Global Constraints

- No new runtime dependencies. Reuse existing helpers (`esc`, `isoToday`, `fmtDate`, `showToast`, `uniqueProjects`, `currentUser`) and CSS (`table.pivot`, `.metric`, `.legend`, `.seg-btn`).
- Holiday doc shape (read-only, exact field names): `{ personId, start, end, type, note, halfDay, halfDayPart }`. Dates are ISO `YYYY-MM-DD`. Half-day leave stores `end === start` and `halfDay === true` with `halfDayPart` `'AM'|'PM'`.
- People doc: `{ name, dept }`. Public-holiday doc: `{ date, name }`.
- Schedule doc: id = `${personId}_${date}`, body `{ personId, date, project, note, by, ts }`. `by = currentUser.name`.
- Leave is matched to a roster row by **exact `personId`** — never by name.
- `currentUser` shape: `{ name, uid, ... }`. Auth boots via `grantAccess()` which calls `startListener()`.
- Tabs/views are driven by the arrays in `setView()` and `render()` and ids `tab-<mode>` / `view-<mode>`.

---

### Task 1: Firestore rules for `sgp_alokasi_schedule`

A new collection path is default-denied; roster **writes** fail until this block is published. (Reads of the `wmf_*` collections already work — they are `if true`.)

**Files:**
- Modify: `firestore.rules` (after the `sgp_alokasi_profiles` block, ~line 70)

- [ ] **Step 1: Add the rules block**

In `firestore.rules`, immediately after:
```
    match /sgp_alokasi_profiles/{id} {
      allow read, write: if true;
    }
```
add:
```
    match /sgp_alokasi_schedule/{id} {
      allow read, write: if true;
    }
```

- [ ] **Step 2: Verify it's present**

Run: `grep -n "sgp_alokasi_schedule" firestore.rules`
Expected: one match showing the new `match` line.

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "rules: allow sgp_alokasi_schedule collection (roster)"
```

> ⚠️ Editing this file does NOT deploy. Publish in Firebase Console → Firestore → Rules (or `firebase deploy --only firestore:rules`). Tell the user roster saving stays broken until they publish.

---

### Task 2: Pure schedule helpers + Node tests (TDD)

Add four pure, top-level functions to the inline script and a Node test that extracts them from the HTML via `vm`.

**Files:**
- Create: `tests/harness/load-alokasi.mjs`
- Create: `tests/schedule.test.mjs`
- Modify: `alokasi-project.html` (inline `<script>`, add helpers next to the other `Data helpers`, ~after line 483 where `isoToday` / `fmtDate` live)

**Interfaces:**
- Produces:
  - `isoOf(d: Date) -> string` — ISO `YYYY-MM-DD` for a Date (local time).
  - `mondayOf(iso: string) -> string` — Monday (ISO) of the week containing `iso` (Mon=start; Sat/Sun roll back to that week's Monday).
  - `weekDates(iso: string) -> string[]` — five ISO weekday dates Mon–Fri of `iso`'s week.
  - `personLeaveOn(holidays: object[], personId: string, iso: string) -> object|null` — the holiday covering that person+date (full-day wins over half-day), else `null`.
  - `publicHolidayName(pubHols: object[], iso: string) -> string|null`.

- [ ] **Step 1: Write the test harness loader**

Create `tests/harness/load-alokasi.mjs`:
```js
/*
 * Loads the inline <script> of alokasi-project.html into a node:vm so its
 * top-level function declarations can be unit-tested in Node — mirroring
 * load-engine.mjs. The inline block is the only attribute-less <script> in
 * the file (open line 453, close line 1195); we pick it by the sentinel
 * 'sgp_alokasi_records'. Browser globals are stubbed; any top-level throw is
 * non-fatal because function declarations are hoisted before execution.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = join(__dirname, '..', '..', 'alokasi-project.html');

function makeEl() {
  return new Proxy(function () {}, {
    get(_t, p) {
      if (p === 'style' || p === 'dataset') return {};
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === 'value' || p === 'textContent' || p === 'className' || p === 'innerHTML') return '';
      return makeEl();
    },
    set() { return true; },
    apply() { return makeEl(); },
  });
}

function colStub() {
  const c = {
    orderBy: () => c, where: () => c,
    onSnapshot: () => {},
    get: () => Promise.resolve({ docs: [] }),
    add: () => Promise.resolve({}),
    doc: () => ({ set: () => Promise.resolve(), delete: () => Promise.resolve(), get: () => Promise.resolve({}) }),
  };
  return c;
}

export function loadAlokasi() {
  const html = readFileSync(HTML, 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('sgp_alokasi_records'));
  if (!inline) throw new Error('alokasi inline script not found');

  const firestore = () => ({ collection: () => colStub() });
  firestore.FieldValue = { serverTimestamp: () => 0, delete: () => 0 };
  const firebase = { apps: [{}], initializeApp() {}, firestore };

  const store = new Map();
  const sandbox = {
    firebase,
    window: { firebaseConfig: {}, addEventListener() {}, location: { hash: '' }, Grimoire: undefined },
    document: { getElementById: () => makeEl(), querySelector: () => makeEl(), querySelectorAll: () => [], createElement: () => makeEl(), addEventListener() {}, body: makeEl() },
    location: { hash: '' },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    Grimoire: { Theme: { init() {}, toggle() {} } },
    GrimoireAuth: { restore: () => Promise.resolve(null), clearSession() {} },
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { userAgent: 'node-test' },
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);
  try { vm.runInContext(inline, ctx, { filename: 'alokasi-inline.js' }); }
  catch (err) {
    if (typeof sandbox.weekDates !== 'function') {
      throw new Error('alokasi inline failed to load: ' + err.message);
    }
  }
  return sandbox;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/schedule.test.mjs`:
```js
/* Unit tests for the pure schedule helpers in alokasi-project.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAlokasi } from './harness/load-alokasi.mjs';

const a = loadAlokasi();

test('mondayOf: rolls any weekday/weekend back to that week Monday', () => {
  assert.equal(a.mondayOf('2026-06-30'), '2026-06-29'); // Tue -> Mon
  assert.equal(a.mondayOf('2026-06-29'), '2026-06-29'); // Mon -> itself
  assert.equal(a.mondayOf('2026-07-05'), '2026-06-29'); // Sun -> that week Mon
});

test('weekDates: five Mon-Fri ISO dates of the week', () => {
  assert.deepEqual(
    Array.from(a.weekDates('2026-07-01')),
    ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03']
  );
});

test('personLeaveOn: matches by personId + date range, full beats half', () => {
  const hols = [
    { personId: 'p1', start: '2026-06-30', end: '2026-07-03', type: 'vacation' },
    { personId: 'p2', start: '2026-07-01', end: '2026-07-01', type: 'sick', halfDay: true, halfDayPart: 'AM' },
    { personId: 'p1', start: '2026-07-01', end: '2026-07-01', type: 'wfh', halfDay: true, halfDayPart: 'PM' },
  ];
  assert.equal(a.personLeaveOn(hols, 'p1', '2026-07-01').type, 'vacation'); // full wins
  assert.equal(a.personLeaveOn(hols, 'p2', '2026-07-01').halfDay, true);
  assert.equal(a.personLeaveOn(hols, 'p1', '2026-07-04'), null);            // out of range
  assert.equal(a.personLeaveOn(hols, 'p3', '2026-07-01'), null);            // no such person
});

test('publicHolidayName: exact date lookup', () => {
  const ph = [{ date: '2026-07-01', name: 'Test Day' }];
  assert.equal(a.publicHolidayName(ph, '2026-07-01'), 'Test Day');
  assert.equal(a.publicHolidayName(ph, '2026-07-02'), null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/schedule.test.mjs`
Expected: FAIL — `a.mondayOf is not a function` (helpers not added yet).

- [ ] **Step 4: Add the helpers to the inline script**

In `alokasi-project.html`, in the `/* ── Data helpers ── */` block (just after the `fmtDate` function, ~line 483), insert:
```js
/* ── Schedule date + leave helpers (pure; unit-tested in tests/schedule.test.mjs) ── */
function isoOf(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
/* Monday (ISO) of the week containing iso. Mon=0…Sun=6, so weekends roll back. */
function mondayOf(iso){
  const d = new Date(iso+'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay()+6)%7));
  return isoOf(d);
}
/* The five weekday ISO dates Mon–Fri of iso's week. */
function weekDates(iso){
  const mon = new Date(mondayOf(iso)+'T00:00:00');
  const out = [];
  for (let i=0;i<5;i++){ const d=new Date(mon); d.setDate(mon.getDate()+i); out.push(isoOf(d)); }
  return out;
}
/* Holiday covering (personId, iso), full-day preferred over half-day, else null. */
function personLeaveOn(holidays, personId, iso){
  let half = null;
  for (const h of holidays){
    if (h.personId !== personId) continue;
    if (!(h.start <= iso && h.end >= iso)) continue;
    if (h.halfDay){ if (!half) half = h; }
    else return h;
  }
  return half;
}
/* Public-holiday name for an ISO date, or null. */
function publicHolidayName(pubHols, iso){
  const m = pubHols.find(p => p.date === iso);
  return m ? m.name : null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/schedule.test.mjs`
Expected: PASS (4 tests). Also run the full suite to confirm no regression: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/harness/load-alokasi.mjs tests/schedule.test.mjs alokasi-project.html
git commit -m "feat(alokasi): pure schedule date/leave helpers + tests"
```

---

### Task 3: Schedule data layer (collection refs, state, load, listener, write)

Wire Firestore: read holiday data once, subscribe to assignments live, upsert/clear a cell. No UI yet.

**Files:**
- Modify: `alokasi-project.html` (inline `<script>`: collection refs ~line 457; state vars ~line 459-467; new functions after the Firestore listener block ~line 523)

**Interfaces:**
- Consumes: `mondayOf`, `isoToday`, `currentUser`, `showToast` (Task 2 / existing).
- Produces:
  - State: `scheduleAssignments` (`{ "<personId>_<date>": {project,note,by} }`), `htPeople`, `htHolidays`, `htPublicHols`, `htLoaded`, `schedMonday`, `schedDept`.
  - `schedDocId(personId, date) -> string`
  - `loadHolidayData() -> Promise<void>` (idempotent; sets `htLoaded`)
  - `startScheduleListener() -> void` (idempotent)
  - `setAssignment(personId, date, project, note) -> Promise<void>` (empty project+note ⇒ delete)

- [ ] **Step 1: Add collection refs**

After `const col = db.collection('sgp_alokasi_records');` (~line 457) add:
```js
const schedCol      = db.collection('sgp_alokasi_schedule');
const htPeopleCol   = db.collection('wmf_holiday_people');
const htHolidaysCol = db.collection('wmf_holidays');
const htPubHolCol   = db.collection('wmf_public_holidays');
```

- [ ] **Step 2: Add state vars**

After `let importRows = [];` (~line 467) add:
```js
let scheduleAssignments = {};                 /* `${personId}_${date}` -> {project,note,by} */
let htPeople        = [];                      /* wmf_holiday_people [{id,name,dept}] */
let htHolidays      = [];                      /* wmf_holidays */
let htPublicHols    = [];                      /* wmf_public_holidays [{date,name}] */
let htLoaded        = false;                   /* holiday data fetched this session */
let schedUnsub      = null;
let schedMonday     = mondayOf(isoToday());    /* visible week (Mon ISO) */
let schedDept       = '';                      /* dept filter */
```

- [ ] **Step 3: Add the data-layer functions**

After the `showLoading()` function (~line 527) add:
```js
/* ── Schedule data layer ── */
function schedDocId(personId, date){ return `${personId}_${date}`; }

/* One-time fetch of the Holiday Tracker roster + leave + public holidays.
   ponytail: session snapshot, not a live listener — a page reload refreshes it.
   Staff rarely add a holiday and immediately re-plan the same minute. */
async function loadHolidayData(){
  if (htLoaded) return;
  const [pSnap, hSnap, phSnap] = await Promise.all([
    htPeopleCol.get(), htHolidaysCol.get(), htPubHolCol.get()
  ]);
  htPeople     = pSnap.docs.map(d=>({id:d.id, ...d.data()}))
                   .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  htHolidays   = hSnap.docs.map(d=>d.data());
  htPublicHols = phSnap.docs.map(d=>d.data());
  htLoaded = true;
}

/* Live assignments, like the records listener. */
function startScheduleListener(){
  if (schedUnsub) return;
  schedUnsub = schedCol.onSnapshot(snap=>{
    scheduleAssignments = {};
    snap.docs.forEach(d=>{ scheduleAssignments[d.id] = d.data(); });
    if (viewMode==='schedule') render();
  }, err=>{ console.error(err); showToast('Schedule sync error: '+err.message, true); });
}

/* Upsert a cell; clearing both project and note deletes the doc. */
async function setAssignment(personId, date, project, note){
  const id = schedDocId(personId, date);
  project = (project||'').trim(); note = (note||'').trim();
  try {
    if (!project && !note){ await schedCol.doc(id).delete(); return; }
    await schedCol.doc(id).set({
      personId, date, project, note,
      by: currentUser ? currentUser.name : '',
      ts: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
  } catch(e){ showToast('Could not save assignment: '+e.message, true); }
}
```

- [ ] **Step 4: Smoke-check the inline script still parses**

Run: `node --test tests/schedule.test.mjs`
Expected: PASS — the harness loads the (now extended) inline script with no syntax error and the Task 2 helpers still resolve. (The new Firestore refs use the harness `colStub`.)

- [ ] **Step 5: Commit**

```bash
git add alokasi-project.html
git commit -m "feat(alokasi): schedule data layer — load holidays, live assignments, upsert"
```

---

### Task 4: Schedule tab, view wiring, week navigator + dept filter (empty grid)

Add the tab and a `renderSchedule()` that paints the toolbar (week nav + dept filter) and a roster grid skeleton. Lazy-init the data layer on first open.

**Files:**
- Modify: `alokasi-project.html` — tab button (~line 369, after Personnel), view div (~line 393), `setView()` (~line 572), `render()` (~line 580), CSS in `<style>` (~before line 267), new `renderSchedule()` (add near `renderPeople`, ~after line 860)

**Interfaces:**
- Consumes: `weekDates`, `schedMonday`, `schedDept`, `htPeople`, `loadHolidayData`, `startScheduleListener`, `fmtDate`, `esc`.
- Produces: `setView('schedule')` path; `renderSchedule()`; `schedWeek(delta)`, `schedThisWeek()`, `setSchedDept(v)`.

- [ ] **Step 1: Add the tab button**

In the `.seg` group, after the Personnel button (~line 369):
```html
<button class="seg-btn" id="tab-schedule" onclick="setView('schedule')">Schedule</button>
```
(Order becomes Records · Quantity · Personnel · Schedule · People · Analytics.)

- [ ] **Step 2: Add the view container**

After `<div id="view-personnel" style="display:none"></div>` (~line 392) add:
```html
<div id="view-schedule" style="display:none"></div>
```

- [ ] **Step 3: Wire setView() and render()**

In `setView()` replace the array `['records','quantity','personnel','people','analytics']` with one that includes `'schedule'` (after `'personnel'`). Then, at the end of `setView()` (before `render()`), add filter-bar visibility + lazy init:
```js
document.getElementById('filter-bar').style.display = (mode==='schedule') ? 'none' : '';
if (mode==='schedule'){ startScheduleListener(); loadHolidayData().then(render).catch(e=>showToast('Could not load holiday data: '+e.message,true)); }
```
In `render()` add, alongside the other view dispatches:
```js
if (viewMode==='schedule') renderSchedule();
```
(Note: `renderSchedule` reads `htPeople`/`scheduleAssignments` from memory; it does not use the records `list`.)

- [ ] **Step 4: Add CSS**

In the `<style>` block (e.g. after the `.pivot` rules, ~line 152) add:
```css
.sched-toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:1rem; }
.sched-week { font-family:var(--grotesk); font-weight:700; font-size:14px; color:var(--text); min-width:190px; text-align:center; }
table.sched td.cell { vertical-align:top; min-width:130px; }
table.sched td.cell select, table.sched td.cell input { width:100%; border:1px solid var(--border); border-radius:4px; padding:4px 6px; font-family:var(--ibm-mono); font-size:11px; background:var(--surface2); color:var(--text); margin-bottom:3px; }
table.sched td.leave { background:var(--warn-light); color:var(--text2); text-align:center; font-family:var(--ibm-mono); font-size:11px; }
table.sched td.half { background:var(--warn-light); }
table.sched .half-flag { font-family:var(--ibm-mono); font-size:9px; color:var(--warn); display:block; margin-bottom:2px; }
table.sched th.pubhol, table.sched td.pubhol { background:var(--accent-light); }
table.sched th.pubhol .ph-name { display:block; font-size:9px; color:var(--accent); font-weight:400; }
```

- [ ] **Step 5: Add renderSchedule() (toolbar + skeleton)**

Near `renderPeople` (~after line 860) add:
```js
/* ── Schedule (forward roster) ── */
function schedWeek(delta){ const d=new Date(schedMonday+'T00:00:00'); d.setDate(d.getDate()+delta*7); schedMonday=isoOf(d); render(); }
function schedThisWeek(){ schedMonday=mondayOf(isoToday()); render(); }
function setSchedDept(v){ schedDept=v; render(); }

function renderSchedule(){
  const host = document.getElementById('view-schedule');
  if (!htLoaded){ host.innerHTML = `<div class="panel"><div class="empty"><div class="empty-icon">⏳</div><div>Loading roster…</div></div></div>`; return; }
  const dates = weekDates(schedMonday);
  const depts = [...new Set(htPeople.map(p=>p.dept).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const ppl = htPeople.filter(p=>!schedDept || p.dept===schedDept);
  const WEEKDAY = ['Mon','Tue','Wed','Thu','Fri'];

  const toolbar = `<div class="sched-toolbar">
    <div class="seg">
      <button class="seg-btn" onclick="schedWeek(-1)">‹</button>
      <button class="seg-btn" onclick="schedThisWeek()">This week</button>
      <button class="seg-btn" onclick="schedWeek(1)">›</button>
    </div>
    <span class="sched-week">${esc(fmtDate(dates[0]))} – ${esc(fmtDate(dates[4]))}</span>
    <div class="spacer"></div>
    <select onchange="setSchedDept(this.value)">
      <option value="">All depts</option>
      ${depts.map(d=>`<option${d===schedDept?' selected':''}>${esc(d)}</option>`).join('')}
    </select>
  </div>`;

  if (!ppl.length){ host.innerHTML = toolbar + `<div class="panel"><div class="empty"><div class="empty-icon">👥</div><div>No people in the Holiday Tracker roster${schedDept?' for this dept':''}.</div></div></div>`; return; }

  const head = `<tr><th class="date">Person</th>${dates.map((iso,i)=>{
    const ph = publicHolidayName(htPublicHols, iso);
    return `<th class="${ph?'pubhol':''}">${WEEKDAY[i]} ${esc(fmtDate(iso))}${ph?`<span class="ph-name">${esc(ph)}</span>`:''}</th>`;
  }).join('')}</tr>`;

  const body = ppl.map(p=>`<tr>
    <td class="date">${esc(p.name)}${p.dept?`<div style="font-size:9px;color:var(--text3)">${esc(p.dept)}</div>`:''}</td>
    ${dates.map(iso=>schedCellHtml(p, iso)).join('')}
  </tr>`).join('');

  const legend = `<div class="legend" style="margin-top:10px">
    <span><span class="sw" style="background:var(--warn-light)"></span>On leave</span>
    <span><span class="sw" style="background:var(--accent-light)"></span>Public holiday</span>
    <span><span class="sw" style="background:var(--surface2)"></span>Assignable</span>
  </div>`;

  host.innerHTML = toolbar + `<div class="panel"><div class="pivot-scroll"><table class="pivot sched"><thead>${head}</thead><tbody>${body}</tbody></table></div>${legend}</div>`;
}
```
(`schedCellHtml` is added in Task 5; this step renders the toolbar + header + person column. If running this task standalone before Task 5, temporarily stub `function schedCellHtml(){ return '<td class="cell"></td>'; }` — Task 5 replaces it.)

- [ ] **Step 6: Verify in the browser**

Publish the Task 1 rules first (or saving will error, but the view still renders). Open `alokasi-project.html` (via the preview tooling or a local static server), sign in, click **Schedule**. Expect: week navigator with This-week label, dept filter populated from the tracker, one row per tracker person, five weekday columns, public-holiday columns shaded/labelled. `‹ / ›` change the week; dept filter narrows rows.

- [ ] **Step 7: Commit**

```bash
git add alokasi-project.html
git commit -m "feat(alokasi): Schedule tab — week navigator, dept filter, roster grid"
```

---

### Task 5: Roster cells — leave/public-holiday states + assign/clear editing

Render each cell per its state and wire editing through `setAssignment`.

**Files:**
- Modify: `alokasi-project.html` — add `schedCellHtml()` (next to `renderSchedule`) and `onSchedProject` / `onSchedNote` handlers; replace the Task-5 stub if present.

**Interfaces:**
- Consumes: `personLeaveOn`, `publicHolidayName`, `scheduleAssignments`, `schedDocId`, `setAssignment`, `uniqueProjects`, `esc`, `LEAVE_TYPE_ICONS-equivalent`.
- Produces: `schedCellHtml(person, iso) -> string`, `onSchedProject(personId, date, value)`, `onSchedNote(personId, date, value)`.

- [ ] **Step 1: Add a local leave-icon map**

Near the top of the schedule section add (the tracker's icons; kept local so we don't import its file):
```js
const SCHED_LEAVE_ICON = { vacation:'🌴', sick:'🤒', wfh:'🏠', training:'📚', parental:'👶', other:'📌' };
```

- [ ] **Step 2: Add schedCellHtml() and edit handlers**

```js
/* One roster cell: public holiday (column) > full-day leave (blocked) > editable. */
function schedCellHtml(p, iso){
  if (publicHolidayName(htPublicHols, iso)) return `<td class="cell pubhol"></td>`;
  const leave = personLeaveOn(htHolidays, p.id, iso);
  if (leave && !leave.halfDay){
    const ic = SCHED_LEAVE_ICON[leave.type] || '📌';
    return `<td class="leave">${ic} ${esc(leave.type)}</td>`;
  }
  const a = scheduleAssignments[schedDocId(p.id, iso)] || {};
  const halfFlag = leave && leave.halfDay
    ? `<span class="half-flag">½ ${esc(leave.halfDayPart||'')} off</span>` : '';
  const opts = ['<option value="">— project —</option>']
    .concat(uniqueProjects().map(pr=>`<option${pr===a.project?' selected':''}>${esc(pr)}</option>`)).join('');
  return `<td class="cell ${leave&&leave.halfDay?'half':''}">
    ${halfFlag}
    <select onchange="onSchedProject('${esc(p.id)}','${iso}',this.value)">${opts}</select>
    <input type="text" value="${esc(a.note||'')}" placeholder="note…" onchange="onSchedNote('${esc(p.id)}','${iso}',this.value)">
  </td>`;
}

/* Project change → upsert immediately (carries the existing note). */
function onSchedProject(personId, date, value){
  const a = scheduleAssignments[schedDocId(personId, date)] || {};
  setAssignment(personId, date, value, a.note || '');
}
/* Note commits on blur/Enter (change), not per keystroke.
   ponytail: the live snapshot re-renders the grid; committing on change (not
   input) keeps typing from being interrupted. */
function onSchedNote(personId, date, value){
  const a = scheduleAssignments[schedDocId(personId, date)] || {};
  setAssignment(personId, date, a.project || '', value);
}
```
(Remove the temporary `schedCellHtml` stub from Task 4 Step 5 if you added it.)

- [ ] **Step 3: Verify end-to-end in the browser**

With the Task 1 rules **published**: open Schedule. Pick a person you know has a vacation in the visible week → those weekday cells show `🌴 vacation` and have no inputs. A half-day shows `½ AM/PM off` above an editable cell. On a free cell, choose a project → it persists (reload, still there) and appears for other signed-in users live. Clear the project and note → the cell empties and the Firestore doc is deleted. A public-holiday column is shaded with no inputs.

- [ ] **Step 4: Run the test suite (no regression)**

Run: `npm test`
Expected: all tests PASS (the inline script still loads cleanly under the harness).

- [ ] **Step 5: Commit**

```bash
git add alokasi-project.html
git commit -m "feat(alokasi): roster cells — leave/holiday states + assign/clear editing"
```

---

## Self-Review

**Spec coverage:**
- Forward roster grid, person × Mon–Fri week, prev/next nav → Tasks 4 (toolbar/grid) + 5 (cells). ✓
- Rows from `wmf_holiday_people`, exact `personId` leave match → Task 3 (`loadHolidayData`, `htPeople`) + 5 (`personLeaveOn` by `p.id`). ✓
- One project + note per cell → Task 5 (`schedCellHtml`). ✓
- Full-day leave hard-blocks; half-day editable+flagged; public-holiday column shaded → Task 5. ✓
- New `sgp_alokasi_schedule`, doc id `${personId}_${date}`, live listener, upsert/delete → Tasks 1 (rules) + 3 (`schedCol`, listener, `setAssignment`). ✓
- One-time holiday fetch, cached → Task 3 (`loadHolidayData`, `htLoaded`). ✓
- Reuse auth/theme/toast/CSS, inline, no refactor → all tasks. ✓
- Verification: pure-logic self-check → Task 2 Node tests. ✓
- Out of scope (multi-project, export, record pre-fill, per-user restrictions) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. The only intentional temporary stub (`schedCellHtml` in Task 4) is explicitly defined and replaced in Task 5.

**Type/name consistency:** `schedDocId`, `setAssignment`, `loadHolidayData`, `startScheduleListener`, `scheduleAssignments`, `htPeople/htHolidays/htPublicHols`, `schedMonday/schedDept`, `weekDates/mondayOf/isoOf/personLeaveOn/publicHolidayName`, `schedCellHtml/onSchedProject/onSchedNote` are used consistently across tasks. Person id is `p.id` (from `wmf_holiday_people` doc id) everywhere leave is matched.
