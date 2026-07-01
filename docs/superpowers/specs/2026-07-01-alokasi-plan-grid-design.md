# Project Allocation — Plan tab becomes a weekly allocation grid

**Date:** 2026-07-01
**File touched:** `alokasi-project.html` (inline JS + CSS), `tests/`
**Reused collection (reshaped):** `sgp_alokasi_schedule` — one doc **per cell** (date × project) instead of per person
**Reused collection (repurposed):** `sgp_alokasi_projects` — from due-date meta to **column registry** (name / order / hidden)

## Goal

Rebuild the **Plan** tab to match how the team actually allocates in
`ALOKASI PROJECT.xlsx`: a **date × project grid you fill in per day**. Rows are days,
columns are projects, each cell names who's assigned. This replaces the single-day lane
cockpit (`renderCockpit` / `renderWeekOverview`) that shipped 2026-06-30.

"Redesign like this" = the Excel's **"Alokasi Personal in project"** sheet. Data is **not**
imported from the Excel — only its layout is the reference.

## Decisions (locked in brainstorming)

| Question | Decision |
|---|---|
| Direction | Grid **replaces** the Plan cockpit. Records + Analyze unchanged. |
| Cell content | **Staff picker + free-text note.** Multi-select roster people, plus an optional free-text suffix (holds `(checking)`, codes like `161`, or names not in the roster). |
| Quantity grid | **Out.** The Excel's separate QUANTITY DATA grid is not built; volume stays in Records (total/done). |
| Window | **One week at a time** — Mon–Fri (reuses `weekDates`), `‹ week ›` navigator. |
| Columns | **Managed project list** — explicit, ordered; add / rename / reorder / hide. |
| Cell doc shape | **One doc per cell**, keyed `${date}_${projectSlug}`. |
| Editing UX | **Click cell → popover editor** (roster checklist + note). No inline multi-select, no drag. |
| Leave/holiday | **Kept** — public-holiday days shaded, leave-people disabled in the editor (helper already exists, free). |

## Information architecture

Tab bar stays **Plan · Records · Analyze**. Only Plan changes.

- `renderPlan()` now calls a single `renderGrid()`. The `planMode` Day/Week split,
  `renderCockpit()`, `renderWeekOverview()`, and the lane/capacity/backlog/deadline-risk
  logic are **deleted**.
- Records (add/edit form, table, import/export, CSV, briefing) — unchanged.
- Analyze (Overview · Pivots · People) — unchanged. `#people` deep link still lands there.
- `#filter-bar` stays hidden on Plan (Plan has its own week/dept controls), same as today.

### Deleted with the cockpit (explicit)

The four "lenses" from the 2026-06-30 redesign go away: throughput/capacity, project
backlog burn-down, per-person load classification, deadline risk (`throughputByPerson`,
`projectBacklog`, `personLoad`, `riskTier`, and the lane ranking). `workingDaysBetween` and
its tests may stay (harmless, still correct) or be removed with the rest — implementer's
call; nothing else consumes them.

## Data model

### Assignments — `sgp_alokasi_schedule` (reshaped to one doc per cell)

Today: `${personId}_${date}_${projectSlug}` = `{ personId, date, project, qty, note, by, ts }`
(one project per person per day, `qty` per person). The grid's unit is the **cell**, so:

```
docId = `${date}_${projectSlug(project)}`      // no personId
{
  date,                 // ISO "YYYY-MM-DD"
  project,              // exact project string
  people,              // [personId, …]  — order preserved for display
  note,                // free-text suffix; "" when none
  by, ts
}
```

New writer `setCell(date, project, personIds, note)`:
- `people` empty **and** `note` empty → `delete` the doc.
- otherwise `set(..., {merge:true})` with `by`/`ts` like `setAssignment` does today.

The `onSnapshot` listener (`startScheduleListener`) is unchanged in shape — it already keys
`scheduleAssignments` by docId; render reads `scheduleAssignments[`${date}_${slug}`]`.

`// ponytail: yesterday's per-person docs (${personId}_${date}_${slug}, negligible real
data) are simply not read by the new cell renderer; they render as nothing and can be left
to rot or bulk-deleted once. No migration written — same no-real-data stance as the cockpit
spec.`

### Column registry — `sgp_alokasi_projects` (repurposed)

Was project due-date meta for the cockpit's risk lens. Becomes the ordered column list:

```
docId = projectSlug(name)
{ name, order, hidden }        // order: number asc; hidden: bool (default false)
```

- Columns rendered = registry docs where `!hidden`, sorted by `order` then `name`.
- **Seed once from existing data:** on first load, if the registry is empty, offer to
  populate it from `uniqueProjects(records)` (or the user adds columns manually). This is a
  convenience, not an Excel import.
- "Manage columns" control: add (name → next `order`), rename (`name`, keep slug/doc — or
  create new + hide old), reorder (bump `order`), hide (`hidden=true`). Keep it a small
  inline editor; no separate modal unless it gets busy.
- `dueDate` field, if present on old docs, is ignored (dormant). `// ponytail: leave stale
  dueDate fields in place; deleting them is busywork with no reader.`
- `startProjMetaListener` stays (renamed conceptually to the column registry); `setProjectDue`
  is replaced by `setColumn` / `hideColumn` / `reorderColumn` helpers.

#### Firestore rules

Both `match /sgp_alokasi_schedule/{id}` and `match /sgp_alokasi_projects/{id}` blocks
**already exist** in `firestore.rules` — no rule change and no new publish for the reshape.
⚠️ Caveat: if the 2026-06-30 `sgp_alokasi_projects` rule was written to the file but never
**published** to the live Firebase project, column writes fail silently until it is
(Console → Firestore → Rules, or `firebase deploy --only firestore:rules`). Verify once.

### Derived — nothing new stored

Roster (people + depts), leave, and public holidays all come from the Holiday Tracker
snapshot already loaded by `loadHolidayData()`.

## Grid UI (`renderGrid`)

Replaces `renderCockpit` + `renderWeekOverview`. Inherits existing CSS tokens, `.metric`,
`.panel`, theme, `showToast`, `esc`, `fmtDate`, `isoToday`.

1. **Toolbar:** `‹` / `week label (Mon–Fri range)` / `›` navigator (state = current Monday,
   via `mondayOf` / `weekDates`); a **This week** reset; dept filter (`All` + depts from the
   roster); **Manage columns** control.
2. **Grid table** (horizontal scroll wrapper):
   - Sticky left **Day** column: 5 rows Mon–Fri, each `weekday + date`; public-holiday days
     shaded + labelled (`publicHolidayName`).
   - Project columns from the registry (order, non-hidden). Header = project name.
   - Cell = staff chips (`personName` from roster) + muted note text; empty cell shows a
     faint `+`. Click anywhere in the cell opens the editor.
3. **Cell editor popover** (`WMF · Wed 17 Dec`): roster checkboxes (people on **full-day
   leave** that date disabled + flagged via `personLeaveOn`), a note text input, and
   **Save** / **Clear cell**. Save → `setCell`; clear → `setCell` with empty selection +
   empty note (deletes). Live via the existing listener.

`// ponytail: transpose (days↔projects), drag-and-drop, and a quantity layer are all
deferred — tap/checkbox editing needs no library and the Excel orientation (days down,
projects across) is what the team already reads.`

## Reuse (lazy)

Auth (`currentUser`), theme, `showToast`, `esc`, `num`, `isoToday`, `fmtDate`,
`uniqueProjects`, `splitStaff`/`personName`, roster from `loadHolidayData`, and **all**
schedule date/leave helpers (`mondayOf`, `weekDates`, `personLeaveOn`, `publicHolidayName`,
`projectSlug`) — already unit-tested. `startScheduleListener` / `startProjMetaListener`
reused as-is (doc-id shape is internal to the writers/renderers).

## Out of scope (v1)

- The QUANTITY DATA grid (volume numbers per project per day).
- Transpose orientation, drag-and-drop assignment.
- Capacity / backlog / deadline-risk lenses (deleted with the cockpit).
- Importing data from `ALOKASI PROJECT.xlsx`.
- Column rename that rewrites historical assignment `project` strings (rename edits the
  registry label only; old cell docs keep their original `project`/slug).

## Considered & rejected

- **Keep the cockpit, add a Grid mode:** rejected — user chose replace; two editors of the
  same schedule data is exactly the redundancy the last redesign removed.
- **Per-person docs + a separate per-cell note doc:** rejected — more writes, and code-only
  cells (`161`) have no person doc to hang a note on. One cell doc is simpler and covers it.
- **Auto-derive columns from records:** rejected — user wants a stable, ordered, controllable
  column set (projects with no records yet must still show).
- **Free-text-only cell (no roster picker):** rejected — the picker keeps names consistent
  and enables leave-awareness; the note field already covers codes and off-roster names.

## Verification

Pure helpers keep assert-based tests in the existing harness (`tests/harness/load-alokasi.mjs`
loads top-level declarations via `node:vm`):

- `projectSlug` — case / spaces / punctuation / trim (already covered; keep).
- `weekDates` / `mondayOf` — Mon–Fri set for a given date (already covered; keep).
- Cell-doc id + `setCell` delete-on-empty rule — `people:[]` + `note:""` deletes; otherwise
  upserts. (Extract the id/empty decision as a pure helper so it's testable without Firestore.)

Manual: add two projects as columns and reorder them; assign a cell (2 people + a note),
reload, confirm it persists and syncs live; confirm a full-day leave greys that person in
the editor; confirm a public holiday shades its row; confirm Records and Analyze (incl.
`#people` deep link) are unaffected.
