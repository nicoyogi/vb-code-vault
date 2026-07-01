# Project Allocation Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Project Allocation into a decision-making "Plan cockpit" that fuses load-balancing, coverage, backlog burn-down and deadline lenses, and collapse the six overlapping tabs into three.

**Architecture:** All changes are inline in the single file `alokasi-project.html` (plus `firestore.rules` and one new test file). New decision logic is added as pure, unit-tested top-level functions; the Schedule roster view is replaced by a Day cockpit + Week overview; the Quantity/Personnel/Analytics/People tabs merge into one Analyze tab with an inner switch. Assignments gain a `qty` field and a per-project document id so a person can be split across projects in a day.

**Tech Stack:** Vanilla HTML/CSS/JS, Firebase Firestore (compat SDK, `onSnapshot` listeners), `node:test` + `node:vm` test harness, SheetJS (already loaded on demand).

## Global Constraints

- Single file: all app code stays inline in `alokasi-project.html`. No new runtime dependencies, no build step.
- Reuse existing helpers and CSS: `esc`, `num`, `isoToday`, `fmtDate`, `isoOf`, `mondayOf`, `weekDates`, `personLeaveOn`, `publicHolidayName`, `splitStaff`, `staffArr`, `personName`, `effStatus`, `recComp`, `uniqueProjects`, `peopleRollup`, `applyFilters`, `showToast`, `scrollToForm`, and the CSS classes `.metric`, `.panel`, `.pill`, `.legend`, `.seg`/`.seg-btn`, `table.pivot`, `.sched-toolbar`, `.sched-week`.
- Pure logic must be top-level `function` declarations so the test harness (`tests/harness/load-alokasi.mjs`, which loads the inline script via `node:vm` keyed on the `sgp_alokasi_records` sentinel) can reach them. Tuning constants live near the top of the script (with `PROJECTS_SEED`) so they initialise before any code runs.
- Test command: `node --test` (runs every `tests/*.test.mjs`). Focused run: `node --test tests/cockpit.test.mjs`.
- Firestore: every collection is `allow read, write: if true`. New collection paths are **default-denied** until a rules block is published manually in Firebase Console → Firestore → Rules. Editing `firestore.rules` does NOT deploy.
- Copy: sentence case, no emoji in code identifiers (UI may keep the existing emoji-in-markup style for parity with the current file).
- Assignment doc id: `` `${personId}_${date}_${projectSlug(project)}` ``. Project meta doc id: `projectSlug(name)`.
- Commit after every task with a `feat(alokasi):` / `test(alokasi):` / `chore(alokasi):` prefix. End commit messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

- `alokasi-project.html` — modify inline `<script>` and `<style>`. New pure helpers + constants near the top; cockpit render functions replacing the schedule render functions; Analyze tab plumbing; data-layer changes.
- `firestore.rules` — add one `sgp_alokasi_projects` match block.
- `tests/cockpit.test.mjs` — **new** — unit tests for the pure decision logic.

---

### Task 1: Pure decision logic + unit tests

Additive only — no existing behaviour changes. Adds the tuning constants and the pure functions the cockpit will call, plus their tests. The page still renders exactly as before after this task.

**Files:**
- Modify: `alokasi-project.html` (inline script — constants after `EKSP_SEED` ~line 493; functions after the schedule date/leave helpers block ~line 537)
- Test: `tests/cockpit.test.mjs` (create)

**Interfaces:**
- Consumes: existing top-level `num`, `effStatus`, `staffArr`, `personName`, `isoOf`.
- Produces (all top-level):
  - `projectSlug(project) -> string`
  - `ageDays(fromIso, toIso) -> number`
  - `workingDaysBetween(fromIso, toIso, pubHols) -> number` (`pubHols` = array of `{date}`)
  - `projectBacklog(records, today) -> { [project]: {remaining, oldestAgeDays, openRecs} }`
  - `throughputByPerson(records, today, windowDays?) -> { [personName]: avgDonePerActiveDay }`
  - `capacityFor(name, throughputMap, halfDay) -> number`
  - `personLoadByDay(assignments, date) -> { [personId]: sumQty }` (`assignments` = map of docId -> `{personId,date,qty,...}`)
  - `loadTier(load, capacity) -> 'free'|'ontrack'|'over'`
  - `riskTier(remaining, daysLeft, plannedToday) -> {tier:'overdue'|'slip'|'tight'|'ontrack', neededPerDay}`

- [ ] **Step 1: Write the failing tests**

Create `tests/cockpit.test.mjs`:

```js
/* Unit tests for the pure cockpit decision helpers in alokasi-project.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAlokasi } from './harness/load-alokasi.mjs';

const a = loadAlokasi();

test('projectSlug: lowercase, non-alnum -> _, trimmed', () => {
  assert.equal(a.projectSlug('TRUMPF'), 'trumpf');
  assert.equal(a.projectSlug('Siemens Freia'), 'siemens_freia');
  assert.equal(a.projectSlug('A/B C!'), 'a_b_c');
  assert.equal(a.projectSlug(''), '');
});

test('ageDays: whole days, clamped at 0', () => {
  assert.equal(a.ageDays('2026-06-20', '2026-06-30'), 10);
  assert.equal(a.ageDays('2026-07-10', '2026-06-30'), 0); // future record
  assert.equal(a.ageDays('', '2026-06-30'), 0);
});

test('workingDaysBetween: Mon-Fri inclusive, minus public holidays', () => {
  assert.equal(a.workingDaysBetween('2026-06-29', '2026-07-03', []), 5); // Mon..Fri
  assert.equal(a.workingDaysBetween('2026-06-29', '2026-07-03', [{date:'2026-07-01'}]), 4);
  assert.equal(a.workingDaysBetween('2026-06-29', '2026-06-29', []), 1); // single Mon
  assert.equal(a.workingDaysBetween('2026-06-29', '2026-07-05', []), 5); // Sun excluded
  assert.equal(a.workingDaysBetween('2026-07-03', '2026-06-29', []), 0); // from > to
});

test('projectBacklog: remaining over OPEN records only + oldest age', () => {
  const recs = [
    {project:'X', total:100, done:40, status:'Proses',  date:'2026-06-20'},
    {project:'X', total:50,  done:50, status:'Selesai', date:'2026-06-22'},
    {project:'Y', total:30,  done:0,  status:'Proses',  date:'2026-06-28'},
  ];
  const b = a.projectBacklog(recs, '2026-06-30');
  assert.equal(b.X.remaining, 60);
  assert.equal(b.X.openRecs, 1);
  assert.equal(b.X.oldestAgeDays, 10);
  assert.equal(b.Y.remaining, 30);
  assert.equal(b.Y.oldestAgeDays, 2);
});

test('throughputByPerson: avg done per active day within window', () => {
  const recs = [
    {staff:['Ihsa'], done:100, total:100, date:'2026-06-29'},
    {staff:['Ihsa'], done:140, total:140, date:'2026-06-30'},
    {staff:['Nico'], done:50,  total:50,  date:'2026-01-01'}, // out of 30d window
  ];
  const tp = a.throughputByPerson(recs, '2026-06-30', 30);
  assert.equal(tp.Ihsa, 120);
  assert.equal(tp.Nico, undefined);
});

test('capacityFor: throughput, half-day halves, default when unknown', () => {
  assert.equal(a.capacityFor('Ihsa', {Ihsa:120}, false), 120);
  assert.equal(a.capacityFor('Ihsa', {Ihsa:120}, true), 60);
  assert.equal(a.capacityFor('Ghost', {}, false), 150); // DEFAULT_CAPACITY
});

test('personLoadByDay + loadTier', () => {
  const asg = {
    x:{personId:'p1', date:'2026-06-30', qty:200},
    y:{personId:'p1', date:'2026-06-30', qty:50},
    z:{personId:'p2', date:'2026-06-29', qty:80},
  };
  const loads = a.personLoadByDay(asg, '2026-06-30');
  assert.equal(loads.p1, 250);
  assert.equal(loads.p2, undefined);
  assert.equal(a.loadTier(250, 220), 'over');
  assert.equal(a.loadTier(0, 150), 'free');
  assert.equal(a.loadTier(100, 150), 'ontrack');
});

test('riskTier: overdue / slip / tight / ontrack', () => {
  assert.equal(a.riskTier(1240, 4, 250).tier, 'slip');   // needs 310 > 250
  assert.equal(a.riskTier(1240, 4, 250).neededPerDay, 310);
  assert.equal(a.riskTier(880, 5, 200).tier, 'ontrack');  // needs 176
  assert.equal(a.riskTier(100, 0, 0).tier, 'overdue');
  assert.equal(a.riskTier(0, 3, 0).tier, 'ontrack');
  assert.equal(a.riskTier(190, 1, 200).tier, 'tight');    // 190 > 180 (0.9*200)
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/cockpit.test.mjs`
Expected: FAIL — `a.projectSlug is not a function` (and similar) because the helpers do not exist yet.

- [ ] **Step 3: Add the tuning constants**

In `alokasi-project.html`, immediately after the `EKSP_SEED` line (~line 493), add:

```js
/* ── Cockpit tuning knobs (calibration; tweak if estimates feel off) ── */
const DEFAULT_CAPACITY  = 150;   /* assumed daily throughput when a person has no recent records */
const OVERLOAD_RATIO    = 1.0;   /* load > capacity * this => overloaded */
const TIGHT_RATIO       = 0.9;   /* neededPerDay > plannedToday * this => "tight" */
const THROUGHPUT_WINDOW = 30;    /* days of history used to estimate throughput */
```

- [ ] **Step 4: Add the pure helpers**

In `alokasi-project.html`, after `validCounts` (~line 564, end of the "Data helpers" block), add:

```js
/* ── Cockpit decision logic (pure; unit-tested in tests/cockpit.test.mjs) ── */
function projectSlug(project){
  return String(project||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
function ageDays(fromIso, toIso){
  if(!fromIso || !toIso) return 0;
  const x = (new Date(toIso+'T00:00:00') - new Date(fromIso+'T00:00:00'))/86400000;
  return Math.max(0, Math.round(x));
}
/* Count Mon–Fri in [fromIso,toIso] inclusive, minus any public-holiday dates. */
function workingDaysBetween(fromIso, toIso, pubHols){
  if(!fromIso || !toIso || fromIso > toIso) return 0;
  const skip = new Set((pubHols||[]).map(p=>p.date));
  let n = 0;
  const d = new Date(fromIso+'T00:00:00'), end = new Date(toIso+'T00:00:00');
  while(d <= end){
    const dow = d.getDay();                 /* 0 Sun … 6 Sat */
    if(dow>=1 && dow<=5 && !skip.has(isoOf(d))) n++;
    d.setDate(d.getDate()+1);
  }
  return n;
}
/* project -> { remaining, oldestAgeDays, openRecs } over OPEN (not Selesai) records. */
function projectBacklog(records, today){
  const m = {};
  records.forEach(r=>{
    if(effStatus(r)==='Selesai') return;
    const p = r.project || '—';
    const o = m[p] = m[p] || { remaining:0, oldestAgeDays:0, openRecs:0 };
    o.remaining += Math.max(0, num(r.total)-num(r.done));
    o.openRecs++;
    const age = ageDays(r.date, today);
    if(age > o.oldestAgeDays) o.oldestAgeDays = age;
  });
  return m;
}
/* personName -> avg done per active day over the trailing window. */
function throughputByPerson(records, today, windowDays){
  windowDays = windowDays || THROUGHPUT_WINDOW;
  const cutoff = (()=>{ const d=new Date(today+'T00:00:00'); d.setDate(d.getDate()-windowDays); return isoOf(d); })();
  const m = {};
  records.forEach(r=>{
    if(!r.date || r.date < cutoff || r.date > today) return;
    [...new Set(staffArr(r).map(personName).filter(Boolean))].forEach(n=>{
      const o = m[n] = m[n] || { done:0, days:new Set() };
      o.done += num(r.done); o.days.add(r.date);
    });
  });
  const out = {};
  Object.entries(m).forEach(([n,o])=>{ out[n] = o.days.size ? Math.round(o.done/o.days.size) : 0; });
  return out;
}
function capacityFor(name, throughputMap, halfDay){
  let cap = (throughputMap && throughputMap[name]) || DEFAULT_CAPACITY;
  if(!cap) cap = DEFAULT_CAPACITY;
  return halfDay ? Math.round(cap/2) : cap;
}
/* personId -> summed qty of that person's assignments on a date. */
function personLoadByDay(assignments, date){
  const m = {};
  Object.values(assignments||{}).forEach(asg=>{
    if(asg.date !== date) return;
    m[asg.personId] = (m[asg.personId]||0) + num(asg.qty);
  });
  return m;
}
function loadTier(load, capacity){
  if(load <= 0) return 'free';
  if(load > capacity * OVERLOAD_RATIO) return 'over';
  return 'ontrack';
}
/* {tier, neededPerDay} for a project's deadline pressure on the selected day. */
function riskTier(remaining, daysLeft, plannedToday){
  if(remaining <= 0) return { tier:'ontrack', neededPerDay:0 };
  if(daysLeft <= 0)  return { tier:'overdue', neededPerDay:remaining };
  const neededPerDay = Math.ceil(remaining / daysLeft);
  if(neededPerDay > plannedToday)              return { tier:'slip',   neededPerDay };
  if(neededPerDay > plannedToday * TIGHT_RATIO) return { tier:'tight',  neededPerDay };
  return { tier:'ontrack', neededPerDay };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/cockpit.test.mjs`
Expected: PASS — all 8 tests green.

- [ ] **Step 6: Run the full suite (regression — confirms the file still parses/loads)**

Run: `node --test`
Expected: PASS — `tests/schedule.test.mjs`, `diff`, `helpers`, `processors`, and `cockpit` all green.

- [ ] **Step 7: Commit**

```bash
git add alokasi-project.html tests/cockpit.test.mjs
git commit -m "$(cat <<'EOF'
test(alokasi): pure cockpit decision logic (backlog, throughput, load, risk)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Firestore rules + project-meta data layer (due dates)

Additive. Adds the `sgp_alokasi_projects` collection (project due dates), its rules block, a live listener, and an upsert helper. Nothing renders it yet.

**Files:**
- Modify: `firestore.rules` (after the `sgp_alokasi_schedule` block, lines 71-73)
- Modify: `alokasi-project.html` (collections block ~line 469; state vars ~line 488; listener helpers ~line 609)

**Interfaces:**
- Consumes: `projectSlug` (Task 1), `db`, `firebase.firestore.FieldValue`.
- Produces (top-level): `projMeta` (map slug -> `{name,dueDate}`), `startProjMetaListener()`, `setProjectDue(project, dueIso)`.

- [ ] **Step 1: Add the Firestore rules block**

In `firestore.rules`, after line 73 (the closing `}` of the `sgp_alokasi_schedule` block), add:

```
    match /sgp_alokasi_projects/{id} {
      allow read, write: if true;
    }
```

- [ ] **Step 2: Add the collection reference**

In `alokasi-project.html`, in the collections block (after `htPubHolCol` ~line 472), add:

```js
const projMetaCol   = db.collection('sgp_alokasi_projects');
```

- [ ] **Step 3: Add state**

After `let schedDept = '';` (~line 490), add:

```js
let projMeta        = {};                       /* projectSlug -> {name, dueDate} */
let projMetaUnsub   = null;
let planMode        = 'day';                    /* 'day' | 'week' */
let schedDay        = isoToday();               /* selected day in the cockpit */
```

- [ ] **Step 4: Add the listener + upsert helper**

After `startScheduleListener` (~line 609), add:

```js
/* Live project meta (due dates). */
function startProjMetaListener(){
  if (projMetaUnsub) return;
  projMetaUnsub = projMetaCol.onSnapshot(snap=>{
    projMeta = {};
    snap.docs.forEach(d=>{ projMeta[d.id] = d.data(); });
    if (viewMode==='plan') render();
  }, err=>{ console.error(err); showToast('Project meta sync error: '+err.message, true); });
}
/* Set/clear a project's due date. Empty date deletes the meta doc. */
async function setProjectDue(project, dueIso){
  const id = projectSlug(project);
  try {
    if (!dueIso){ await projMetaCol.doc(id).delete(); return; }
    await projMetaCol.doc(id).set({ name:project, dueDate:dueIso }, {merge:true});
  } catch(e){ showToast('Could not save due date: '+e.message+' (publish Firestore rules?)', true); }
}
```

- [ ] **Step 5: Run the full suite (regression — file must still load)**

Run: `node --test`
Expected: PASS — all tests green (the harness stubs Firestore, so the new collection/listener load without error).

- [ ] **Step 6: Commit**

```bash
git add firestore.rules alokasi-project.html
git commit -m "$(cat <<'EOF'
feat(alokasi): project-meta data layer for due dates (sgp_alokasi_projects)

Adds the collection, its rules block (publish manually in Firebase console),
a live listener and a setProjectDue upsert/clear helper.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

> ⚠️ After merge: publish `firestore.rules` in Firebase Console → Firestore → Rules. Due-date writes fail silently until then.

---

### Task 3: Plan cockpit — Day mode (replaces the Schedule roster)

The core task. Changes the assignment data model (`qty` + per-project doc id), renames the `schedule` view to `plan`, replaces the roster render functions with the Day cockpit (people availability + ranked project lanes + plan→actual), and wires assignment edit/remove and log-from-plan.

**Files:**
- Modify: `alokasi-project.html` — `schedDocId`/`setAssignment` (~584, ~612); tab button + view div + `setView`/`render` (~379, ~403, ~668, ~686); `<style>` (add cockpit CSS before `</style>` ~line 275); replace `schedCellHtml`/`onSchedProject`/`onSchedNote`/`renderSchedule` (~914-987).

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 `projMeta`/`startProjMetaListener`/`setProjectDue`, existing `htPeople`/`htHolidays`/`htPublicHols`/`scheduleAssignments`/`records`, `SCHED_LEAVE_ICON`, `schedWeek`, `setSchedDept`, `scrollToForm`, `loadHolidayData`, `startScheduleListener`.
- Produces (top-level): `renderPlan()`, `renderCockpit()`, `planNav(delta)`, `planToday()`, `setPlanMode(m)`, `addAssign(project,day,pid)`, `removeAssign(personId,day,project)`, `assignControl(project,day,ppl)`, `dayActual(records,day,project)`, `logFromPlan(project,day)`. Changes `schedDocId(personId,date,project)` and `setAssignment(personId,date,project,qty,note)`.

- [ ] **Step 1: Change the assignment doc id to be per-project**

Replace `schedDocId` (~line 584):

```js
function schedDocId(personId, date, project){ return `${personId}_${date}_${projectSlug(project)}`; }
```

- [ ] **Step 2: Change `setAssignment` to carry qty**

Replace `setAssignment` (~lines 612-623) with:

```js
/* Upsert a person·day·project assignment; qty<=0 and no note deletes it. */
async function setAssignment(personId, date, project, qty, note){
  const id = schedDocId(personId, date, project);
  project = (project||'').trim(); note = (note||'').trim(); qty = num(qty);
  try {
    if (qty<=0 && !note){ await schedCol.doc(id).delete(); return; }
    await schedCol.doc(id).set({
      personId, date, project, qty, note,
      by: currentUser ? currentUser.name : '',
      ts: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
  } catch(e){ showToast('Could not save assignment: '+e.message, true); }
}
```

- [ ] **Step 3: Rename the Schedule tab to Plan and make it the cockpit**

In the tab bar (~line 379), replace:

```html
      <button class="seg-btn" id="tab-schedule" onclick="setView('schedule')">Schedule</button>
```

with:

```html
      <button class="seg-btn" id="tab-plan" onclick="setView('plan')">Plan</button>
```

In the view divs (~line 403), replace `<div id="view-schedule" style="display:none"></div>` with:

```html
  <div id="view-plan" style="display:none"></div>
```

- [ ] **Step 4: Update `setView` and `render` to use `plan`**

Replace `setView` (~lines 668-677):

```js
function setView(mode){
  viewMode = mode;
  ['records','quantity','personnel','plan','people','analytics'].forEach(m=>{
    const tab = document.getElementById('tab-'+m);
    const view = document.getElementById('view-'+m);
    if (tab) tab.classList.toggle('active', m===mode);
    if (view) view.style.display = m===mode ? '' : 'none';
  });
  document.getElementById('filter-bar').style.display = (mode==='plan') ? 'none' : '';
  if (mode==='plan'){
    startScheduleListener(); startProjMetaListener();
    loadHolidayData().then(render).catch(e=>showToast('Could not load holiday data: '+e.message,true));
  }
  render();
}
```

In `render` (~line 686), replace `if (viewMode==='schedule') renderSchedule();` with:

```js
  if (viewMode==='plan')      renderPlan();
```

- [ ] **Step 5: Add the cockpit CSS**

In the `<style>` block, immediately before the closing `</style>` (~line 275), add:

```css
    /* Plan cockpit */
    .ck-people { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-bottom:1.2rem; }
    .ck-pcard { background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius); padding:8px 10px; }
    .ck-pcard.leave { opacity:.55; }
    .ck-pname { font-family:var(--grotesk); font-weight:700; font-size:12.5px; color:var(--text); }
    .ck-load { font-family:var(--ibm-mono); font-size:10.5px; color:var(--text2); }
    .ck-status { font-family:var(--ibm-mono); font-size:10px; margin-top:4px; }
    .ck-bar { height:6px; border-radius:6px; background:var(--bg2); overflow:hidden; margin-top:6px; }
    .ck-bar > span { display:block; height:100%; }
    .ck-lane { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); box-shadow:var(--shadow); padding:.9rem 1.1rem; margin-bottom:.8rem; }
    .ck-lane-head { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:baseline; }
    .ck-rank { font-family:var(--ibm-mono); font-size:10px; color:var(--text3); }
    .ck-proj { font-family:var(--grotesk); font-size:15px; font-weight:700; color:var(--text); }
    .ck-meta { font-family:var(--ibm-mono); font-size:11px; color:var(--text2); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .ck-badge { font-size:10px; padding:2px 8px; border-radius:4px; font-weight:600; }
    .ck-badge.slip, .ck-badge.overdue { background:var(--danger-light); color:var(--danger); }
    .ck-badge.tight { background:var(--warn-light); color:var(--warn); }
    .ck-badge.ontrack { background:var(--success-light); color:var(--success); }
    .ck-badge.none { background:var(--accent-light); color:var(--text3); }
    .ck-cov { margin-top:8px; }
    .ck-cov-row { display:flex; justify-content:space-between; font-family:var(--ibm-mono); font-size:10.5px; color:var(--text2); margin-bottom:3px; }
    .ck-chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; align-items:center; }
    .ck-chip { display:inline-flex; align-items:center; gap:6px; background:var(--surface2); border:1px solid var(--border2); border-radius:20px; padding:3px 6px 3px 10px; font-family:var(--ibm-mono); font-size:11px; color:var(--text); }
    .ck-chip .q { color:var(--text2); }
    .ck-chip button { border:none; background:none; cursor:pointer; color:var(--text3); font-size:13px; line-height:1; padding:0 2px; }
    .ck-chip button:hover { color:var(--danger); }
    .ck-assign { display:inline-block; }
    .ck-assign summary { list-style:none; cursor:pointer; }
    .ck-foot { font-family:var(--ibm-mono); font-size:10.5px; color:var(--text3); margin-top:8px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
    .ck-week { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }
    .ck-day { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:.8rem; cursor:pointer; }
    .ck-day:hover { border-color:var(--accent); }
    .ck-day.pubhol { background:var(--accent-light); }
```

- [ ] **Step 6: Replace the roster render functions with the cockpit**

Replace the block from `schedCellHtml` through the end of `renderSchedule` (~lines 914-987). Keep `schedWeek`/`schedThisWeek`/`setSchedDept` (~907-909) and `SCHED_LEAVE_ICON` (~911) as they are. New code:

```js
function renderPlan(){ if(planMode==='week') return renderWeekOverview(); return renderCockpit(); }
function planNav(delta){ const d=new Date(schedDay+'T00:00:00'); d.setDate(d.getDate()+delta); schedDay=isoOf(d); schedMonday=mondayOf(schedDay); render(); }
function planToday(){ schedDay=isoToday(); schedMonday=mondayOf(schedDay); render(); }
function setPlanMode(m){ planMode=m; if(m==='day') schedMonday=mondayOf(schedDay); render(); }

function planToolbar(label){
  const depts=[...new Set(htPeople.map(p=>p.dept).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  return `<div class="sched-toolbar">
    <div class="seg">
      <button class="seg-btn ${planMode==='day'?'active':''}" onclick="setPlanMode('day')">Day</button>
      <button class="seg-btn ${planMode==='week'?'active':''}" onclick="setPlanMode('week')">Week</button>
    </div>
    <div class="seg">
      <button class="seg-btn" onclick="${planMode==='day'?'planNav(-1)':'schedWeek(-1)'}">‹</button>
      <button class="seg-btn" onclick="${planMode==='day'?'planToday()':'schedThisWeek()'}">${planMode==='day'?'Today':'This week'}</button>
      <button class="seg-btn" onclick="${planMode==='day'?'planNav(1)':'schedWeek(1)'}">›</button>
    </div>
    <span class="sched-week">${esc(label)}</span>
    <div class="spacer"></div>
    <select onchange="setSchedDept(this.value)">
      <option value="">All depts</option>
      ${depts.map(d=>`<option value="${esc(d)}"${d===schedDept?' selected':''}>${esc(d)}</option>`).join('')}
    </select>
  </div>`;
}

/* Available (assignable) people for a day, as <option>s. */
function assignControl(project, day, ppl){
  const opts = ppl.filter(p=>{ const lv=personLeaveOn(htHolidays,p.id,day); return !(lv&&!lv.halfDay); })
    .map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  const pid = 'asg_'+projectSlug(project)+'_'+day;
  return `<details class="ck-assign"><summary class="btn-sm">+ assign</summary>
    <span style="display:inline-flex;gap:6px;align-items:center;margin-left:6px;margin-top:6px">
      <select id="${pid}_p" style="height:28px">${opts}</select>
      <input id="${pid}_q" type="number" min="0" step="1" placeholder="qty" style="width:78px;height:28px">
      <button class="btn-sm" onclick="addAssign('${esc(project)}','${day}','${pid}')">add</button>
    </span></details>`;
}
function addAssign(project, day, pid){
  const personId=document.getElementById(pid+'_p').value;
  const qty=num(document.getElementById(pid+'_q').value);
  if(!personId){ showToast('Pick a person.', true); return; }
  if(qty<=0){ showToast('Enter a quantity.', true); return; }
  setAssignment(personId, day, project, qty, '');
}
function removeAssign(personId, day, project){ setAssignment(personId, day, project, 0, ''); }
function dayActual(records, day, project){
  let done=0, total=0;
  records.forEach(r=>{ if(r.date===day && (r.project||'—')===project){ done+=num(r.done); total+=num(r.total); } });
  return { done, total };
}
function logFromPlan(project, day){
  setView('records');
  document.getElementById('f-date').value = day;
  document.getElementById('f-project').value = project;
  const names = Object.values(scheduleAssignments)
    .filter(a=>a.date===day && a.project===project)
    .map(a=>(htPeople.find(x=>x.id===a.personId)||{}).name).filter(Boolean);
  document.getElementById('f-staff').value = names.join(', ');
  scrollToForm();
}

function renderCockpit(){
  const host=document.getElementById('view-plan');
  if(!htLoaded){ host.innerHTML=`<div class="panel"><div class="empty"><div class="empty-icon">⏳</div><div>Loading roster…</div></div></div>`; return; }
  const day=schedDay, today=isoToday();
  const ppl=htPeople.filter(p=>!schedDept||p.dept===schedDept);
  const tp=throughputByPerson(records, today);
  const loads=personLoadByDay(scheduleAssignments, day);
  const backlog=projectBacklog(records, today);
  const ph=publicHolidayName(htPublicHols, day);

  /* people availability */
  let onLeaveCount=0;
  const peopleCards=ppl.map(p=>{
    const leave=personLeaveOn(htHolidays, p.id, day);
    if(leave && !leave.halfDay){
      onLeaveCount++;
      const ic=SCHED_LEAVE_ICON[leave.type]||'📌';
      return `<div class="ck-pcard leave"><div class="ck-pname">${esc(p.name)}</div><div class="ck-status">${ic} ${esc(leave.type)} — can't assign</div></div>`;
    }
    const half=!!(leave&&leave.halfDay);
    const cap=capacityFor(personName(p.name), tp, half);
    const load=loads[p.id]||0;
    const tier=loadTier(load, cap);
    const color= tier==='over'?'var(--danger)' : tier==='free'?'var(--text3)' : 'var(--success)';
    const pct= cap? Math.min(100, Math.round(load/cap*100)) : 0;
    const statusTxt= tier==='over'?`overloaded · ${load-cap} over` : tier==='free'?'free' : 'on track';
    const halfFlag= half? ` <span class="ck-badge tight">½ ${esc(leave.halfDayPart||'')} off</span>` : '';
    return `<div class="ck-pcard">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="ck-pname">${esc(p.name)}</span><span class="ck-load">${load} / ${cap}</span></div>
      <div class="ck-bar"><span style="width:${tier==='free'?4:pct}%;background:${color}"></span></div>
      <div class="ck-status" style="color:${color}">${statusTxt}${halfFlag}</div>
    </div>`;
  }).join('');

  /* lanes */
  const dayAssigns=Object.values(scheduleAssignments).filter(a=>a.date===day);
  const byProject={}; dayAssigns.forEach(a=>{ (byProject[a.project]=byProject[a.project]||[]).push(a); });
  const projSet=[...new Set([...Object.keys(backlog).filter(p=>backlog[p].remaining>0), ...Object.keys(byProject)])];
  const lanes=projSet.map(p=>{
    const bl=backlog[p]||{remaining:0,oldestAgeDays:0,openRecs:0};
    const assigns=byProject[p]||[];
    const plannedToday=assigns.reduce((s,a)=>s+num(a.qty),0);
    const meta=projMeta[projectSlug(p)]||{};
    const due=meta.dueDate||'';
    let risk={tier: due?'':'none', neededPerDay:0, daysLeft:0};
    if(due){ const dl=workingDaysBetween(day, due, htPublicHols); risk={...riskTier(bl.remaining, dl, plannedToday), daysLeft:dl}; }
    return {p, bl, assigns, plannedToday, due, risk};
  });
  const tierRank={overdue:0,slip:1,tight:2,ontrack:3,none:4,'':4};
  lanes.sort((a,b)=> (tierRank[a.risk.tier]-tierRank[b.risk.tier]) || (b.bl.remaining-a.bl.remaining) || (b.bl.oldestAgeDays-a.bl.oldestAgeDays));

  const laneHtml=lanes.map((L,i)=>{
    const badgeTxt = !L.due ? 'no deadline'
      : (L.risk.tier==='slip'||L.risk.tier==='overdue') ? 'will slip'
      : L.risk.tier==='tight' ? 'tight' : 'on track';
    const badge=`<span class="ck-badge ${L.due?L.risk.tier:'none'}">${badgeTxt}</span>`;
    const dueCtl=`<input type="date" value="${esc(L.due)}" onchange="setProjectDue('${esc(L.p)}',this.value)" title="Set / clear due date" style="width:140px;height:28px">`;
    const covRight= L.due ? `needs ${L.risk.neededPerDay}/day${L.risk.daysLeft<=0?' (overdue)':''}` : (L.assigns.length?'room for more':'unassigned');
    const covPct= L.bl.remaining ? Math.min(100, Math.round(L.plannedToday/L.bl.remaining*100)) : (L.plannedToday?100:0);
    const covColor= (L.risk.tier==='slip'||L.risk.tier==='overdue')?'var(--danger)' : L.risk.tier==='tight'?'var(--warn)' : L.plannedToday?'var(--success)':'var(--accent)';
    const chips=L.assigns.map(a=>{
      const nm=(htPeople.find(x=>x.id===a.personId)||{}).name||a.personId;
      return `<span class="ck-chip">${esc(nm)} <span class="q">${num(a.qty)}</span><button onclick="removeAssign('${esc(a.personId)}','${day}','${esc(a.project)}')" aria-label="remove" title="remove">×</button></span>`;
    }).join('');
    const act=dayActual(records, day, L.p);
    const actPct= act.total? ` (${Math.round(act.done/act.total*100)}% of ${act.total.toLocaleString()})` : '';
    return `<div class="ck-lane">
      <div class="ck-lane-head">
        <div><span class="ck-rank">#${i+1}</span> <span class="ck-proj">${esc(L.p)}</span> ${badge}</div>
        <div class="ck-meta">📥 ${L.bl.remaining.toLocaleString()} open · oldest ${L.bl.oldestAgeDays}d ${dueCtl}</div>
      </div>
      <div class="ck-cov">
        <div class="ck-cov-row"><span>planned today ${L.plannedToday.toLocaleString()}</span><span>${covRight}</span></div>
        <div class="ck-bar"><span style="width:${covPct}%;background:${covColor}"></span></div>
      </div>
      <div class="ck-chips">${chips}${assignControl(L.p, day, ppl)}</div>
      <div class="ck-foot">↺ today: planned ${L.plannedToday.toLocaleString()} · done ${act.done.toLocaleString()}${actPct} <button class="btn-sm" onclick="logFromPlan('${esc(L.p)}','${day}')">Log a record</button></div>
    </div>`;
  }).join('');

  /* metrics */
  const availCount=ppl.length-onLeaveCount;
  const totalBacklog=Object.values(backlog).reduce((s,o)=>s+o.remaining,0);
  const plannedTotal=dayAssigns.reduce((s,a)=>s+num(a.qty),0);
  const atRisk=lanes.filter(L=>L.risk.tier==='slip'||L.risk.tier==='overdue').length;
  const metrics=`<div class="metrics">
    <div class="metric m-data"><div class="metric-lbl">Available</div><div class="metric-val">${availCount}<span style="font-size:14px;color:var(--text3)"> / ${ppl.length}</span></div><div class="metric-sub">${onLeaveCount} on leave</div></div>
    <div class="metric"><div class="metric-lbl">Open backlog</div><div class="metric-val">${totalBacklog.toLocaleString()}</div><div class="metric-sub">${lanes.length} projects</div></div>
    <div class="metric m-prog"><div class="metric-lbl">Planned</div><div class="metric-val">${plannedTotal.toLocaleString()}</div><div class="metric-sub">${totalBacklog?Math.round(plannedTotal/totalBacklog*100):0}% of backlog</div></div>
    <div class="metric"><div class="metric-lbl">At risk</div><div class="metric-val" style="${atRisk?'color:var(--danger)':''}">${atRisk}</div><div class="metric-sub">deadline slip</div></div>
  </div>`;

  const phBanner= ph?`<div class="panel" style="border-color:var(--accent)"><b>${esc(ph)}</b> — public holiday. Nobody is normally rostered today.</div>`:'';
  const peopleSection=`<div class="panel-head" style="margin:.2rem 0 .5rem">People today <span class="sub">load vs typical throughput</span></div><div class="ck-people">${peopleCards||'<span class="ck-status">No people in roster'+(schedDept?' for this dept':'')+'.</span>'}</div>`;
  const lanesSection= lanes.length
    ? `<div class="panel-head" style="margin:.4rem 0 .5rem">Projects <span class="sub">ranked by backlog + deadline risk</span></div>${laneHtml}`
    : `<div class="panel"><div class="empty"><div class="empty-icon">🎯</div><div>No backlog and no assignments for this day.</div><div class="empty-sub">Add records, or assign people once a project has open data.</div></div></div>`;

  host.innerHTML = planToolbar(fmtDate(day)) + metrics + phBanner + peopleSection + lanesSection;
}
```

- [ ] **Step 7: Run the full suite (regression — confirms the file still parses)**

Run: `node --test`
Expected: PASS — all tests green. (`renderSchedule` is gone; `tests/schedule.test.mjs` only tests the pure date/leave helpers, which remain.)

- [ ] **Step 8: Manual smoke check**

Open `alokasi-project.html` in a browser, sign in, click **Plan**. Expected: Day cockpit renders with the date navigator, summary metrics, a People-today strip (anyone on full-day leave greyed with "can't assign"), and project lanes for any project with open backlog. Assign a person+qty via `+ assign`; the chip appears and the person's load bar updates. Set a near due date on a lane; confirm a `will slip`/`tight` badge. Click `×` on a chip to remove. Click **Log a record**; confirm it switches to Records with date/project/staff prefilled.

- [ ] **Step 9: Commit**

```bash
git add alokasi-project.html
git commit -m "$(cat <<'EOF'
feat(alokasi): Plan cockpit Day mode — replaces the Schedule roster

People availability + ranked project lanes fusing load-balancing, coverage,
backlog burn-down and deadline risk; per-project qty assignments; plan->actual
footer and one-click log-a-record.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Plan cockpit — Week overview mode

Adds the compact Mon–Fri overview: per-day planned total, available count, at-risk badge, public-holiday shading; clicking a day jumps to that Day cockpit.

**Files:**
- Modify: `alokasi-project.html` — add `renderWeekOverview` + `planJump` next to `renderCockpit` (~after the Task 3 block).

**Interfaces:**
- Consumes: Task 1 helpers, `projMeta`, `weekDates`, `personLeaveOn`, `publicHolidayName`, `planToolbar`.
- Produces (top-level): `renderWeekOverview()`, `planJump(iso)`.

- [ ] **Step 1: Add the week overview**

After `renderCockpit` (end of the Task 3 block), add:

```js
function planJump(iso){ schedDay=iso; planMode='day'; schedMonday=mondayOf(iso); render(); }
function renderWeekOverview(){
  const host=document.getElementById('view-plan');
  if(!htLoaded){ host.innerHTML=`<div class="panel"><div class="empty"><div class="empty-icon">⏳</div><div>Loading roster…</div></div></div>`; return; }
  const dates=weekDates(schedMonday), today=isoToday();
  const WEEKDAY=['Mon','Tue','Wed','Thu','Fri'];
  const ppl=htPeople.filter(p=>!schedDept||p.dept===schedDept);
  const backlog=projectBacklog(records, today);
  const cols=dates.map((iso,i)=>{
    const ph=publicHolidayName(htPublicHols, iso);
    const dayAssigns=Object.values(scheduleAssignments).filter(a=>a.date===iso);
    const planned=dayAssigns.reduce((s,a)=>s+num(a.qty),0);
    const avail=ppl.filter(p=>{ const lv=personLeaveOn(htHolidays,p.id,iso); return !(lv&&!lv.halfDay); }).length;
    const byProject={}; dayAssigns.forEach(a=>{ byProject[a.project]=(byProject[a.project]||0)+num(a.qty); });
    let atRisk=0;
    Object.values(projMeta).forEach(m=>{
      if(!m.dueDate || !m.name) return;
      const bl=backlog[m.name]; if(!bl || bl.remaining<=0) return;
      const dl=workingDaysBetween(iso, m.dueDate, htPublicHols);
      const t=riskTier(bl.remaining, dl, byProject[m.name]||0).tier;
      if(t==='slip'||t==='overdue') atRisk++;
    });
    return `<div class="ck-day ${ph?'pubhol':''}" onclick="planJump('${iso}')">
      <div style="font-family:var(--ibm-mono);font-size:10px;color:var(--text3)">${WEEKDAY[i]} ${esc(fmtDate(iso))}</div>
      ${ph
        ? `<div class="ck-badge none" style="margin-top:8px;display:inline-block">${esc(ph)}</div>`
        : `<div class="metric-val" style="font-size:1.4rem;margin-top:6px">${planned.toLocaleString()}</div>
           <div class="ck-status">planned · ${avail} avail</div>
           ${atRisk?`<div class="ck-badge slip" style="margin-top:6px;display:inline-block">${atRisk} at risk</div>`:''}`}
    </div>`;
  }).join('');
  host.innerHTML = planToolbar(`${fmtDate(dates[0])} – ${fmtDate(dates[4])}`) + `<div class="ck-week">${cols}</div>`;
}
```

- [ ] **Step 2: Run the full suite (regression)**

Run: `node --test`
Expected: PASS — all tests green.

- [ ] **Step 3: Manual smoke check**

On the Plan tab, click **Week**. Expected: five day-cards Mon–Fri with planned totals, available counts, and at-risk badges where a deadline would slip; public-holiday columns shaded with the holiday name. Click a day → switches to that Day's cockpit.

- [ ] **Step 4: Commit**

```bash
git add alokasi-project.html
git commit -m "$(cat <<'EOF'
feat(alokasi): Plan cockpit Week overview (per-day totals, at-risk, jump-to-day)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Analyze tab — merge Quantity + Personnel + Analytics + People (6 tabs → 3)

Collapses four retrospective tabs into one **Analyze** tab with an inner Overview · Pivots · People switch. Reorders the tab bar to **Plan · Records · Analyze**. Shows the Add form only on Records, the filter bar on Records + Analyze. Preserves the `#people` deep link.

**Files:**
- Modify: `alokasi-project.html` — tab bar (~376-382), view divs (~400-405), the `#add-box` (~349) visibility, `setView`/`render` (~668-687), the four render functions' signatures (`renderQuantity` ~747, `renderPersonnel` ~771, `renderAnalytics` ~792, `renderPeople` ~989), deep link (~1374).

**Interfaces:**
- Consumes: existing `renderQuantity`, `renderPersonnel`, `renderAnalytics`, `renderPeople`, `applyFilters`.
- Produces (top-level): `renderAnalyze(list)`, `renderPivots(list, host)`, `setAnalyzeTab(t)`; state `analyzeTab`, `pivotKind`. The four render functions gain a `host` parameter.

- [ ] **Step 1: Add Analyze state**

After the Task 2/3 state additions (~line 490), add:

```js
let analyzeTab = 'overview';   /* overview | pivots | people */
let pivotKind  = 'quantity';   /* quantity | personnel */
```

- [ ] **Step 2: Rewrite the tab bar to three tabs**

Replace the whole `.seg` group (~lines 376-381) with:

```html
      <button class="seg-btn active" id="tab-plan"    onclick="setView('plan')">Plan</button>
      <button class="seg-btn" id="tab-records" onclick="setView('records')">Records</button>
      <button class="seg-btn" id="tab-analyze" onclick="setView('analyze')">Analyze</button>
```

> Note: this makes **Plan** the default-active tab in markup. Step 8 sets `viewMode`/initial view to `plan`.

- [ ] **Step 3: Replace the view divs**

Replace lines ~400-405 with:

```html
  <div id="view-plan"></div>
  <div id="view-records" style="display:none"></div>
  <div id="view-analyze" style="display:none"></div>
```

- [ ] **Step 4: Give the four render functions a `host` parameter**

Make these mechanical edits so each writes into a passed host instead of its own view div:

- `renderQuantity(list)` → `renderQuantity(list, host)`; replace its first line `const host = document.getElementById('view-quantity');` with `host = host || document.getElementById('view-quantity');`.
- `renderPersonnel(list)` → `renderPersonnel(list, host)`; replace `const host = document.getElementById('view-personnel');` with `host = host || document.getElementById('view-personnel');`.
- `renderAnalytics(list)` → `renderAnalytics(list, host)`; replace `const host = document.getElementById('view-analytics');` with `host = host || document.getElementById('view-analytics');`.
- `renderPeople(list)` → `renderPeople(list, host)`; replace `const host = document.getElementById('view-people');` with `host = host || document.getElementById('view-people');`.

- [ ] **Step 5: Add the Analyze host + Pivots wrapper**

After `renderPeople` (~line 1042), add:

```js
function setAnalyzeTab(t){ analyzeTab=t; render(); }
function renderPivots(list, host){
  host.innerHTML = `<div class="toolbar"><div class="seg">
    <button class="seg-btn ${pivotKind==='quantity'?'active':''}" onclick="pivotKind='quantity';render()">Quantity</button>
    <button class="seg-btn ${pivotKind==='personnel'?'active':''}" onclick="pivotKind='personnel';render()">Personnel</button>
  </div></div><div id="pivot-body"></div>`;
  const body=document.getElementById('pivot-body');
  if(pivotKind==='quantity') renderQuantity(list, body); else renderPersonnel(list, body);
}
function renderAnalyze(list){
  const host=document.getElementById('view-analyze');
  host.innerHTML = `<div class="toolbar"><div class="seg">
    <button class="seg-btn ${analyzeTab==='overview'?'active':''}" onclick="setAnalyzeTab('overview')">Overview</button>
    <button class="seg-btn ${analyzeTab==='pivots'?'active':''}" onclick="setAnalyzeTab('pivots')">Pivots</button>
    <button class="seg-btn ${analyzeTab==='people'?'active':''}" onclick="setAnalyzeTab('people')">People</button>
  </div></div><div id="analyze-body"></div>`;
  const body=document.getElementById('analyze-body');
  if(analyzeTab==='overview') renderAnalytics(list, body);
  else if(analyzeTab==='pivots') renderPivots(list, body);
  else renderPeople(list, body);
}
```

- [ ] **Step 6: Update `setView` and `render`**

Replace `setView` (the version from Task 3) so the tab/view loop uses the three real ids and the Add form shows on Records only:

```js
function setView(mode){
  viewMode = mode;
  ['plan','records','analyze'].forEach(m=>{
    document.getElementById('tab-'+m).classList.toggle('active', m===mode);
    document.getElementById('view-'+m).style.display = m===mode ? '' : 'none';
  });
  document.getElementById('filter-bar').style.display = (mode==='plan') ? 'none' : '';
  document.getElementById('add-box').style.display    = (mode==='records') ? '' : 'none';
  if (mode==='plan'){
    startScheduleListener(); startProjMetaListener();
    loadHolidayData().then(render).catch(e=>showToast('Could not load holiday data: '+e.message,true));
  }
  render();
}
```

Replace the body of `render` (~lines 678-687) with:

```js
function render(){
  if (!loaded){ showLoading(); return; }
  const list = applyFilters(records);
  if (viewMode==='records') renderRecords(list);
  if (viewMode==='analyze') renderAnalyze(list);
  if (viewMode==='plan')    renderPlan();
}
```

- [ ] **Step 7: Update the `#people` deep link**

Replace the init deep-link line (~line 1374) `if (location.hash === '#people') setView('people');` with:

```js
if (location.hash === '#people'){ analyzeTab='people'; setView('analyze'); }
```

- [ ] **Step 8: Default the initial view to Plan**

Change the `viewMode` initial value (~line 478) from `let viewMode = 'records';` to:

```js
let viewMode = 'plan';
```

And at the end of init (~line 1375, after `checkAuth();`), ensure the default view is shown when there is no `#people` hash — add right after the deep-link line:

```js
else setView('plan');
```

> `grantAccess()` calls `startListener()` which calls `render()`; `setView('plan')` here makes Plan the landing tab and starts its listeners once the user is authed. (If `checkAuth` resolves async after this line, `setView('plan')` still sets the correct visible tab; the listeners are idempotent.)

- [ ] **Step 9: Run the full suite (regression — file must still parse/load)**

Run: `node --test`
Expected: PASS — all tests green.

- [ ] **Step 10: Manual check**

Reload, sign in. Expected: three tabs (Plan · Records · Analyze); Plan is the landing tab; Add form visible only on Records; filter bar hidden on Plan, visible on Records/Analyze. On Analyze, the inner switch toggles Overview (the old analytics), Pivots (Quantity/Personnel sub-toggle), People (scorecards). Visit `alokasi-project.html#people` → lands on Analyze→People. Export/Import/CSV/Briefing still work from the toolbar.

- [ ] **Step 11: Commit**

```bash
git add alokasi-project.html
git commit -m "$(cat <<'EOF'
feat(alokasi): collapse 6 tabs into Plan / Records / Analyze

Analyze hosts Overview, Pivots (Quantity/Personnel) and People behind an inner
switch; Plan is the landing tab; Add form scoped to Records; #people deep link
preserved.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full regression, manual verification, docs

Final gate. Confirms the whole tool works end to end and records the new collection + rules-publish requirement where future readers will see it.

**Files:**
- Modify: `README.md` (if it lists the alokasi tool's features/collections — add Plan cockpit + `sgp_alokasi_projects`).

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: PASS — `cockpit`, `schedule`, `diff`, `helpers`, `processors` all green.

- [ ] **Step 2: Manual end-to-end checklist** (browser, signed in)

Work through and confirm each:
- Plan/Day: a known person's known vacation greys their card ("can't assign"); a half-day shows "½ … off" and halves capacity.
- Assign one person to two projects on the same day → their People-today card flags `overloaded` with the over amount.
- Set a tight due date on a high-backlog lane → `will slip`; loosen it → `on track`. Clear it → `no deadline`.
- `Log a record` from a lane prefills date/project/staff on Records; saving it makes the lane's "done" rise (live).
- Plan/Week: totals, avail, at-risk, public-holiday shading; click a day → Day cockpit.
- Analyze: Overview/Pivots/People all render; `#people` deep link lands on People.
- Records: add/edit/delete+undo, import, CSV, Excel, Briefing all still work.
- Toggle dark/light — cockpit colours adapt.

- [ ] **Step 3: Update README (only if it documents the tool's collections/features)**

If `README.md` lists the Project Allocation tool, add a line noting the **Plan cockpit** and the new `sgp_alokasi_projects` collection (due dates) with the manual-rules-publish caveat. If it does not mention the tool, skip this step.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(alokasi): docs + final verification for the Plan cockpit redesign

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push the branch and open a PR (if the user wants it)**

```bash
git push -u origin feat/alokasi-cockpit-redesign
gh pr create --fill --base main
```

> Reminder to include in the PR description: **publish `firestore.rules`** in the Firebase console — `sgp_alokasi_projects` writes (due dates) fail silently until then.

---

## Self-Review

**1. Spec coverage**
- 3-tab IA (Plan/Records/Analyze) → Task 5. ✓
- Plan cockpit, four lenses fused → Tasks 1 (logic) + 3 (Day UI). ✓ (coverage = leave-greyed people; load = capacity bars + overload; backlog = ranked lanes; deadline = risk badges)
- `qty` field + per-project doc id → Task 3 (`schedDocId`, `setAssignment`). ✓
- `sgp_alokasi_projects` + rules + manual-publish caveat → Task 2 (+ reminders in Tasks 2, 6). ✓
- Derived throughput/backlog/risk, no extra storage → Task 1. ✓
- Plan→actual + log-a-record → Task 3 (`dayActual`, `logFromPlan`). ✓
- Week overview → Task 4. ✓
- `#people` deep link preserved → Task 5 Step 7. ✓
- Add form on Records only, filter bar on Records/Analyze → Task 5 Step 6. ✓
- Reuse of schedule date/leave helpers + existing tests stay green → regression step in every task. ✓
- Verification via pure-helper unit tests → Task 1. ✓

**2. Placeholder scan** — no TBD/TODO/"handle edge cases"; every code step contains complete code; commands have expected output. ✓

**3. Type consistency** — `schedDocId(personId,date,project)` and `setAssignment(personId,date,project,qty,note)` are defined in Task 3 and called consistently by `addAssign`/`removeAssign`/`logFromPlan`. `projMeta` is `{slug: {name,dueDate}}` in Task 2 and read that way in Tasks 3/4. `riskTier` returns `{tier,neededPerDay}` (Task 1) and callers add `daysLeft` locally (Task 3/4). `projectBacklog` returns `{remaining,oldestAgeDays,openRecs}` and is read with those exact keys. The four analyze functions gain a `host` param (Task 5 Step 4) used by `renderPivots`/`renderAnalyze` (Step 5). ✓
