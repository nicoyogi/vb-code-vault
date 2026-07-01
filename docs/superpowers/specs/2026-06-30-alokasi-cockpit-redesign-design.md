# Project Allocation — redesign into an allocation cockpit

**Date:** 2026-06-30
**File touched:** `alokasi-project.html` (inline JS + CSS), `firestore.rules`, `tests/`
**New collection:** `sgp_alokasi_projects` (project meta — due dates)
**Changed collection:** `sgp_alokasi_schedule` — assignment doc gains a `qty` field and a per-project doc id

## Goal

Turn Project Allocation from a record-keeper + analyzer into a **decision tool**.
Today the act of allocating — deciding who works which project tomorrow given the
backlog and who's free — happens in someone's head; the plan (Schedule roster) and
the actuals (Records) are disconnected silos, and six overlapping tabs re-slice the
same date×project data.

The redesign delivers one **Plan cockpit** that fuses four lenses the user explicitly
asked for — **load balancing, coverage, backlog burn-down, deadline-driven** — and
collapses the information architecture from six tabs to three.

This is a single-file change: all new code is added inline to `alokasi-project.html`,
reusing its existing helpers, CSS, auth, and the schedule date/leave helpers that
already ship with unit tests.

## Decisions (locked in brainstorming)

| Question | Decision |
|---|---|
| Direction | Allocation cockpit **+** fresh look (not a reskin-only, not capability-only). |
| Core job | All four lenses fused into one Day cockpit, not four separate features. |
| IA | 3 tabs: **Plan** (new, default) · **Records** (unchanged) · **Analyze** (merges Quantity + Personnel + Analytics + People). |
| Assignment granularity | **person × day × project** with a target `qty` (a person can be split across projects in a day). |
| Capacity reference | Derived from recent Records (avg done/day); constant default when no history; manual override deferred. |
| Deadlines | Optional per-project due date in a small new `sgp_alokasi_projects` collection. |
| Week view | Compact week overview (per-day totals + at-risk), click a day → Day cockpit. Day is the editor. |
| Styling | Inherit the existing grimoire theme (IBM Plex / blue accent / dark-light). The chat mockup used neutral styling only. |

## Information architecture (the "redesign all")

Tab bar becomes: **Plan · Records · Analyze**.

| Tab | What it is | Absorbs / replaces |
|---|---|---|
| **Plan** (default) | The allocation cockpit. Day mode = full cockpit; Week mode = compact overview. | replaces **Schedule** |
| **Records** | Daily log: add/edit form, table, import/export, CSV, briefing. Unchanged behaviour. | **Records** |
| **Analyze** | One retrospective page with an inner segmented switch: **Overview · Pivots · People**. | **Quantity + Personnel + Analytics + People** |

- The standard `#filter-bar` (search / project / staff / status / from–to) applies to
  **Records** and **Analyze** only; it is hidden on **Plan** (which has its own day/dept
  controls) — same pattern the current Schedule tab already uses.
- The Add/Edit form shows on **Records** only (hidden on Plan/Analyze). The header
  `+ Add Record` button switches to Records and focuses the form.
- Deep link `#people` (used by `task-reviewer-siemens.html`) opens **Analyze** with the
  inner switch set to **People**. The deep-link contract is preserved.
- Export / Import / CSV / Briefing toolbar buttons stay available on Records/Analyze.

## Data model

### Assignments — `sgp_alokasi_schedule` (changed)

The current roster doc is `{ personId, date, project, note, by, ts }` keyed
`${personId}_${date}` — **one project per person per day**. The cockpit needs a person
split across projects in a day, so:

- **New doc id:** `` `${personId}_${date}_${projectSlug}` `` where
  `projectSlug = project.toLowerCase().replace(/[^a-z0-9]+/g,'_')`. The exact project
  string is still stored in the `project` body field.
- **New field:** `qty` (number ≥ 0) — the target data for that person·project·day.
- Doc body: `{ personId, date, project, qty, note, by, ts }`.

`// ponytail: legacy Schedule docs keyed ${personId}_${date} (feature merged the same
day, negligible data) are still read by body fields and render fine; re-assigning a
person writes the new-format id. A one-time cleanup of any stragglers is optional, not
required — there is no real data to migrate.`

Upsert/clear keep the existing pattern: `set(id, {...}, {merge:true})`; clearing qty to
0 with an empty note deletes the doc. The collection stays `onSnapshot`-live like Records.

### Project meta — `sgp_alokasi_projects` (new)

One doc per project that has a due date set. Created only when you set one.

```
docId = projectSlug                  // same slug rule as above
{
  name,        // exact project string
  dueDate      // ISO "YYYY-MM-DD"; doc deleted when cleared
}
```

`onSnapshot`-live so deadlines sync across users. Priority pinning and an `active` flag
were considered and **deferred** — ranking is automatic (below) and backlog>0 already
hides dead projects. `// ponytail: add a priority field only if auto-ranking proves wrong.`

#### Firestore rules (REQUIRED, manual publish)

A new collection path is default-denied. Add to `firestore.rules`:

```
match /sgp_alokasi_projects/{id} {
  allow read, write: if true;
}
```

⚠️ Editing `firestore.rules` does **not** deploy. It must be published in
Firebase Console → Firestore → Rules (or `firebase deploy --only firestore:rules`).
**Due-date writes fail silently until this is published.** Same precedent as the
Schedule roster (`sgp_alokasi_schedule`) and the Operation Report `wmf_op_*` collections.
The `sgp_alokasi_schedule` rule block already exists and is unchanged.

### Derived — nothing else stored

All of the following are computed at render time from data already in memory
(`records`, the schedule assignments, the holiday-tracker snapshot). No new storage.

## Derived computations (the four lenses)

These are the load-bearing logic; each gets a **pure helper** so it can be unit-tested
(see Verification). Thresholds are named constants — calibration knobs, not magic numbers.

### Throughput / capacity (load-balancing reference)

- `throughputByPerson(records, today, windowDays=30)` → map `personName → avgDonePerActiveDay`.
  Reuses the existing per-person attribution (full record `done` credited to each named
  staff via `staffArr`/`personName`, the same convention `peopleRollup` already uses),
  restricted to records within the trailing window. A person's capacity = their avg
  `done` over the days they were active.
- `DEFAULT_CAPACITY = 150` (constant) used when a person has no recent history.
- Half-day leave halves the day's capacity for that person.
- `// ponytail: per-person manual capacity override deferred — derived + default is enough
  to flag over/under load; add an override field if estimates feel wrong in practice.`

### Backlog per project (burn-down)

- `projectBacklog(records, today)` → map `project → { remaining, oldestAgeDays, openRecs }`
  where `remaining = Σ max(0, total−done)` over **open** (`effStatus !== 'Selesai'`)
  records, and `oldestAgeDays = max age` among them (`ageOf` pattern already in Analytics).

### Person load (load-balancing, per selected day)

- `personLoad(assignments, date)` → map `personId → Σ qty` of that person's assignments
  on `date`.
- Classification vs capacity: `over` (load > capacity), `full`/`on-track`
  (0 < load ≤ capacity), `free` (load = 0). Constant `OVERLOAD_RATIO = 1.0`.

### Deadline risk (deadline-driven, per selected day)

- `workingDaysBetween(fromIso, toIso, publicHols)` → count of Mon–Fri in `[from, to]`
  excluding public-holiday dates. (Reuses the public-holiday set already loaded.)
- For a project with `dueDate`:
  - `daysLeft = workingDaysBetween(selectedDay, dueDate, pubHols)`
  - `neededPerDay = daysLeft > 0 ? ceil(remaining / daysLeft) : remaining`
  - `plannedToday = Σ qty of that project's assignments on selectedDay`
  - `riskTier(remaining, daysLeft, neededPerDay, plannedToday)`:
    - `overdue` (danger) if `daysLeft ≤ 0 && remaining > 0`
    - `slip` (danger) if `neededPerDay > plannedToday`
    - `tight` (warning) if `neededPerDay > plannedToday * TIGHT_RATIO` (`TIGHT_RATIO=0.9`)
    - `ontrack` (success) otherwise
  - no `dueDate` → `none` (neutral); coverage-only.

### Lane set + ranking

- Lane shown for any project in `{ projects with remaining > 0 } ∪ { projects assigned on the selected day }`.
- Sort: risk first (`overdue/slip` → `tight` → `ontrack/none`), then `remaining` desc,
  then `oldestAgeDays` desc.

### Plan → actual (loop closure)

- For the selected day, per (project, person): `actualDone = Σ done` from `records` with
  that `date` + `project` where the person ∈ `staffArr`. Lane footer shows
  `planned (Σ qty) vs actual done` for the selected day, and the same for the prior
  working day (the mockup's "yesterday" line).
- One-click **Log a record**: a button on the lane prefills the Add form (switches to
  Records) with `date = selectedDay`, `project = lane`, `staff = assigned people`,
  total/done left blank for entry.

## The Plan cockpit (UI)

Inherits all existing CSS tokens, `.metric`, `.panel`, `.pill`, `.legend`, `.seg`,
`table.pivot` sticky cells, theme, `showToast`, `esc`, `fmtDate`, `isoToday`. New cockpit
markup is a self-contained `renderCockpit()` (Day) + `renderWeekOverview()` (Week),
replacing `renderSchedule()`.

### Day mode (primary)

Top-to-bottom (matches the approved chat mockup):

1. **Controls row:** `Day | Week` segment · `‹ / This week or Today / ›` navigator ·
   current date label · dept filter (`All` + depts from `wmf_holiday_people`).
2. **Summary metrics** (reusing `.metric`): Available today (`n / total`, +on-leave) ·
   Open backlog · Planned today (+ % of backlog) · At-risk count (danger-tinted).
3. **People today** strip: one mini-card per roster person (dept-filtered) showing
   `load / capacity`, a load bar coloured by tier (success / danger / muted), and a
   status label. Full-day leave → greyed, "can't assign". Half-day → flag + halved
   capacity. (Coverage + load-balancing lens.)
4. **Project lanes** (ranked): each lane card shows
   - header: rank `#n` · project · risk badge (`will slip` / `on track` / `no deadline`)
   - metrics: `remaining open · oldest Nd` · `due <date>` (if set; inline date input to set/clear)
   - coverage bar: `planned today X` vs `needs Y/day` (or "room for more" when no deadline)
   - assigned chips: `Person qty`, each chip click = edit qty / remove; `+ assign` control
     (person `<select>` of assignable people + qty input → upsert)
   - footer: `planned vs done` for the day + prior working day; **Log a record** button.

### Week mode (overview)

Five columns Mon–Fri (`weekDates(schedMonday)`), each showing: planned total (Σ qty),
available people count (roster minus full-day leave, minus public holiday), and an
at-risk badge if any project would slip that day. Public-holiday columns shaded + labelled
(reuse `publicHolidayName`). Click a column → switch to Day mode on that date.
`// ponytail: week mode is read + navigate only; per-cell editing happens in Day mode —
the multi-project-per-day model makes inline grid editing noisy, add it only if asked.`

### Assignment interaction (no drag in v1)

Tap-to-assign: `+ assign` reveals a person select + qty number input inside the lane;
confirm upserts the schedule doc. Chips edit qty inline and remove via an `×`.
`// ponytail: drag-and-drop deferred — tap-to-assign needs no library and is fully
keyboard-accessible; add DnD only if the team asks.`

## Analyze tab

`renderAnalyze()` hosts an inner `.seg` switch (Overview · Pivots · People) and calls the
**existing** render functions, lightly refactored to take a host element:

- **Overview** = current `renderAnalytics` (metrics, daily trend, project rollup, staff
  leaderboard, status, heatmap, aging backlog).
- **Pivots** = current `renderQuantity` + `renderPersonnel`, with the existing
  Total/Done metric toggle and a Quantity/Personnel sub-toggle.
- **People** = current `renderPeople` (scorecards + workload balance).

These are moves, not rewrites — the analytics/pivot/people logic is unchanged.

## Reuse (lazy)

Existing and reused as-is: alokasi auth (`currentUser`, Grimoire SSO), theme,
`showToast`, `esc`, `num`, `isoToday`, `fmtDate`, `splitStaff`/`staffArr`/`personName`,
`effStatus`/`recComp`, `uniqueProjects`, `peopleRollup`, `applyFilters`, the Excel
import/export, CSV, briefing, the edit/import modals, and **all** schedule date/leave
helpers (`isoOf`, `mondayOf`, `weekDates`, `personLeaveOn`, `publicHolidayName`) — which
already have passing unit tests. `loadHolidayData()` and `startScheduleListener()` are
reused; the schedule listener now also keys by project and reads `qty`.

## Out of scope (v1)

- Drag-and-drop assignment (tap-to-assign instead).
- Per-person manual capacity override (derived + default only).
- Project priority pinning / `active` flag (auto-ranking only).
- Forecasting future incoming volume (backlog = work on hand).
- Auto-creating Records from the plan (one-click prefill only, no auto-write).
- Inline per-cell editing in Week mode (Day mode is the editor).
- Printing the daily plan (briefing already covers retrospective reporting).

## Considered & rejected

- **Keep one-project-per-person-per-day** (no docId change): rejected — load balancing
  with quantities needs a person split across projects; the mockup the user approved
  shows exactly this (Cantya on TRUMPF + WMF).
- **Store capacity / due dates inside `wmf_holiday_people`**: rejected — that is the
  Holiday Tracker's collection; writing allocation data into it is cross-tool pollution.
- **Forecast incoming volume per project**: rejected as YAGNI — open backlog is a good
  enough "work on hand" signal; add forecasting only if the team tracks intake.
- **Full week roster grid (current Schedule) kept alongside the cockpit**: rejected —
  redundant once the Day cockpit exists; the lighter week overview reuses the same
  helpers and avoids two editors of the same data.

## Verification

Pure helpers get assert-based unit tests in the existing harness pattern
(`tests/harness/load-alokasi.mjs` loads top-level function declarations via `node:vm`,
keyed on the `sgp_alokasi_records` sentinel). New tests live in `tests/cockpit.test.mjs`
(or extend `tests/schedule.test.mjs`):

- `workingDaysBetween` — Mon–Fri count excluding public holidays; boundary inclusive;
  `daysLeft ≤ 0` cases.
- `riskTier` — overdue / slip / tight / ontrack / none across the threshold constants.
- `projectBacklog` — remaining = Σ max(0,total−done) over open records only; oldest age.
- `throughputByPerson` — avg done/active-day within the window; default when no history;
  half-day halving.
- `personLoad` + overload classification — Σ qty per person per day vs capacity.
- `projectSlug` — collision/normalisation (case, spaces, punctuation).

Manual: open Plan → confirm a known vacation greys the right person; assign two projects
to one person and confirm the overload flag; set a tight due date and confirm the
"will slip" badge; log a record from a lane and confirm planned-vs-actual updates via the
live listener. Confirm `#people` still lands on Analyze→People.
