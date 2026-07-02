# File Splitter → Note-filter checklist + full-width layout

**Date:** 2026-07-02
**File touched:** `File_splitter.html` (single-file tool), `tests/splitter.test.mjs`

## Problem

The Note filter (card 03) is a free-text textarea: phrases one per line,
case-insensitive contains-match against a merged note. The user must already
know and type the phrases. The notes are in practice a catalog of standard
phrases, so picking should replace typing.

Separately, the page is a centered 620-px column; the user wants the layout
to use the full screen width.

## Decision (from brainstorming)

- Card 03 becomes a **checklist of distinct note values** — the same UI
  pattern as the per-system forwarder picker (search box, `all` / `none`
  mini-buttons, `value — count` rows, count-descending).
- Matching switches from *contains* to **exact-value membership**.
- **Blank-note rows are always kept** — unchanged.
- **Default all checked** = today's "empty box keeps everything".
- Layout goes **full-width**: cards side by side in a responsive grid,
  results tiled, no centering cap.

## The 609-distinct reconciliation

The 2026-07-01 spec measured **609 distinct note strings** across the four
real files and rejected a picker at that cardinality. That count was of
**merged** notes — up to four `Note` columns joined into one string — so
combinations of standard phrases multiply. This design tallies **individual
note cell values** instead: combinations collapse back toward the phrase
catalog. A row is kept iff it has no notes OR **any** of its note values is
checked (any-match mirrors the old contains-any semantics). Residual
variable-tail notes (document numbers etc.) appear as low-count entries at
the bottom of the list — individually tickable, found via search.

## UI

- **Before any upload:** card 03 shows a hint ("Upload files to list their
  notes.") and no controls.
- **After upload:** search box + `all` / `none` buttons (reuse `fwd-search`
  / `fwd-mini`), scrollable checklist (reuse `fwd-list` / `fwd-row`), one row
  per distinct note value with its total row count across all systems,
  sorted count-descending. The filter stays **global** across systems.
- The live stat line stays: `Matches X of Y noted rows; Z blank-note rows
  always kept.` (updates on every check/uncheck and on system add/remove).
- Checked state is keyed by note string and survives list rebuilds; notes
  first seen in a new upload default to **checked**.

## Layout (full-width)

- Drop the `max-width: 620px` cap on header, cards, split button, progress,
  error and results; everything spans the viewport minus body padding.
  No outer max-width — explicit user request ("full screen, not just on
  the middle").
- The three cards are wrapped in a `<main>` grid:
  `grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px`
  → Upload | People | Note filter side by side on wide screens, stacking on
  narrow ones.
- Results become a grid (`repeat(auto-fill, minmax(320px, 1fr))`) so
  per-person cards tile; the summary row spans all columns.

## Implementation notes

- `extractRows`: the projected row's 4th element becomes `notes` — an
  **array** of the non-blank trimmed `Note` cells — replacing the merged
  string. Output projection stays `r.slice(0, 3)`; notes are never written.
- New pure helper `tallyNotes(systems)` → `[{ name, count }]`,
  count-descending (flatten valid systems' rows' note arrays; mirror of
  `tallyForwarders`).
- `noteKeep(notes, checkedSet)`: empty array → `true`; else
  `notes.some(n => checkedSet.has(n))`. `parseNoteTerms` is deleted.
- `updateNoteStat` and the `splitFile` row filter read the checklist state
  (a `Set` of checked note strings) instead of the textarea.
- HTML: card 03 swaps the textarea for the picker markup; cards get a
  `<main>` wrapper; CSS width/grid changes as above.
- **Tests:** replace the `parseNoteTerms` / contains-`noteKeep` cases in
  `tests/splitter.test.mjs` with `tallyNotes` + set-membership `noteKeep`
  cases (harness `load-splitter.mjs` needs no change — top-level function
  declarations).

## Edge cases

- Everything unchecked → only blank-note rows survive; the stat line makes
  this visible before splitting.
- Same note in several systems → one entry, counts summed (filter is
  global, as today).
- Removing a system rebuilds the list; checked state is kept by value,
  entries no longer present drop out.
- A system with a missing required column stays excluded from the tally
  (only valid systems feed the list).

## Verification

Run the four real files (OPP/PS1/KSP/FNP): confirm the checklist lands at
phrase-catalog size (not ~609); `none` + tick one phrase and confirm the
stat and output row counts match that phrase's count plus blank-note rows;
check the layout at desktop width (cards side by side) and narrow width
(stacked). Run `node --test tests/`.
