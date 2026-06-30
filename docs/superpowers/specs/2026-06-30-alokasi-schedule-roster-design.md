# Project Allocation — "Schedule" forward roster (holiday-tracker connected)

**Date:** 2026-06-30
**File touched:** `alokasi-project.html` (inline JS), `firestore.rules`
**New collection:** `sgp_alokasi_schedule`

## Goal

Add a **Schedule** tab to Project Allocation: a forward-looking **person × weekday**
roster for planning who works which project on upcoming days. Leave is pulled live
from the Holiday Tracker so a person who is away cannot be rostered that day.

This is *planning* data, kept separate from the existing retrospective
`sgp_alokasi_records` (which record what was actually done).

## Decisions (locked in brainstorming)

| Question | Decision |
|---|---|
| Core goal | Forward roster grid (assign people to projects on upcoming days). |
| Roster rows | Holiday Tracker roster (`wmf_holiday_people`), matched to leave by exact `personId`. |
| Time window | One week (Mon–Fri) at a time, with `‹ prev / next ›` week navigation. |
| Cell content (v1) | One project per cell + optional short note. |
| Full-day leave | Hard-block the cell (not editable). |
| Public holidays | Shade + label the whole weekday column. |
| Storage | New `sgp_alokasi_schedule`, one doc per cell. Needs a Firestore rules block. |

## Data sources (the "connect")

Same Firebase project; every collection is currently `allow read, write: if true`,
so reads need no rule change.

- **Rows:** `wmf_holiday_people` — `{ id, name, dept }`. Sorted by name; optional dept filter.
- **Leave:** `wmf_holidays` — `{ personId, start, end, type, halfDay, halfDayPart }`,
  ISO `YYYY-MM-DD`. A person is on leave on `day` when `start <= day && end >= day`.
  Match the roster row to leave by `personId` (exact, no name fuzzing).
- **Public holidays:** `wmf_public_holidays` — `{ date, name }`. A weekday column whose
  ISO date is in this set is a public holiday for everyone.

These three are fetched **once** with `.get()` when the Schedule tab is first opened,
then cached in memory for the session. A page reload refreshes them.
`// ponytail: one-time snapshot, not a live listener — staff rarely add a holiday then immediately replan; reload picks it up.`

## Storage — `sgp_alokasi_schedule`

One document per filled cell:

```
docId = `${personId}_${date}`      // date = ISO YYYY-MM-DD; idempotent upsert
{
  personId,   // links to wmf_holiday_people doc id
  date,        // "2026-07-01"
  project,     // string, from the existing project list (free-typed allowed)
  note,        // optional short string, "" if none
  by,          // currentUser display name (who set it)
  ts           // firebase.firestore.FieldValue.serverTimestamp()
}
```

- Setting a cell: `set(docId, {...}, {merge:true})`.
- Clearing a cell: `delete(docId)`.
- The Schedule view subscribes to this collection with `onSnapshot` (live, like Records),
  filtered/rendered for the currently visible week.

### Firestore rules (REQUIRED, manual publish)

A new collection path is default-denied. Add to `firestore.rules`:

```
match /sgp_alokasi_schedule/{id} {
  allow read, write: if true;
}
```

⚠️ Editing `firestore.rules` does **not** deploy. It must be published in
Firebase Console → Firestore → Rules (or `firebase deploy --only firestore:rules`).
**Roster writes fail until this is published.** Same precedent as the Operation
Report `wmf_op_*` collections.

## UI

### Tab

Add a `Schedule` segment button to the existing tab bar, positioned
`Records · Quantity · Personnel · Schedule · People · Analytics`. New
`<div id="view-schedule">`, wired into `setView()` and `render()` like the others.

When `viewMode === 'schedule'`:
- Hide the standard `#filter-bar` (search/project/staff/status/from–to is for record views).
- Show the Schedule's own controls: week navigator (`‹ Mon DD – Fri DD ›`, "This week"
  button) and a dept filter (`All` + departments from `wmf_holiday_people`).

### Grid

- Rows = people (filtered by dept), sticky first column with name + dept, reusing the
  `table.pivot` sticky-cell CSS already in the file.
- Columns = Mon–Fri of the visible week; header shows weekday + `DD Mon`.
- Cell states:
  - **Free:** project `<select>`/input (reuses `dl-project` datalist) + small note input.
    Empty = unassigned. Change → upsert; clear → delete.
  - **Full-day leave:** type icon + label (`🌴 Vacation`, `🤒 Sick`, …, from the
    tracker's `LEAVE_TYPE_ICONS`), greyed, `pointer-events:none`. Not editable.
  - **Half-day leave:** editable, with a `½ AM/PM off` flag; assigning is allowed.
  - **Public-holiday column:** whole column greyed, header labelled with the holiday name.
- Legend below the grid (leave types / public holiday / assigned), reusing `.legend`/`.sw`.

### Permissions

Any logged-in alokasi user can edit the roster (same as Records — no row-level
restriction in v1). `by` records who last set each cell for transparency.

## Reuse (lazy)

Existing alokasi auth (`currentUser`), theme, `showToast`, `esc`, `isoToday`,
`fmtDate`, project datalist + `uniqueProjects()`, `setView` machinery, and the
`table.pivot` / `.metric` / `.legend` CSS. New code is a single self-contained
`renderSchedule()` section plus a small `loadHolidayData()` helper, added inline —
no refactor of the existing 1,198-line file.

## Out of scope (v1)

- Multiple projects / ekspeditur per cell.
- Exporting the roster to Excel/CSV.
- Auto-creating `sgp_alokasi_records` from the plan.
- Per-user edit restrictions.

## Considered & rejected

**Store the plan as future-dated rows in `sgp_alokasi_records`** (avoids the new
collection + rules change). Rejected: pollutes the retrospective "what was done"
records and every analytics rollup, and records use free-text staff names, not
`personId`, which breaks the exact leave match.

## Verification

- `demo()`-style self-check for the pure logic: given a set of holidays + a date,
  the on-leave / half-day / public-holiday classification returns the expected cell
  state. (Asserts, no framework.)
- Manual: open Schedule, confirm a known person's known vacation greys the right cells;
  assign a project on a free day and confirm the doc round-trips via the live listener.
