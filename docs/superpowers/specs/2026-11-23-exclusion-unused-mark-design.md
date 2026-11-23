# Mark unused exclusion entries in red — File Splitter

Date: 2026-11-23
Status: awaiting approval

## What

In step 3 (Exclusions) of `File_splitter.html`, a listed Kreditor or Referenz value
that matches no row in that system's upload is drawn in red inside its textarea, so
an entry that no longer excludes anything is visible without counting rows.

## Why

The card already prints an aggregate: `27 Referenz listed — excludes 1 row.`
(`File_splitter.html:1255-1263`, screenshot of 2026-11-23). With 27 or 45 entries the
one live value is invisible, so stale numbers accumulate and cannot be told apart from
working ones without deleting candidates one at a time.

## Liveness rule

An entry is **live** when it matches at least one row of the same system name, in the
column the exclusion acts on: Supplier (`row[1]`, `normDoc`) for Kreditor, Reference
(`row[2]`, `normDoc` lowercased) for Referenz. Rows are the aggregate of every
non-error system with that name, exactly the set the existing stat counts, so
`sum(hits) === the row count already shown`. Presence elsewhere in the workbook
(a Document number, another system's file) does not make an entry live: it excludes
nothing.

## Goals

- Every listed token carries its own state, not just the list total.
- Marks follow the text you typed, in the same scroll box, at 45 entries as well as 2.
- The row count already shown keeps its meaning and its value.

## Non-goals

- No change to what the split extracts. `splitRows` is untouched.
- No new persistence, no new Firestore doc, no list pruning on the user's behalf.
- No aggregate change: the existing sentence stays, a dead count is appended.

## Constraints

- Single-file page, vanilla JS, no new dependency.
- Must keep the paste-a-column-from-Excel workflow: the input stays a textarea.
- Mirror text must be character-identical to the textarea's, or alignment drifts.
- Screen readers must not read the list twice.

## Approaches

- **A: mirror layer behind the textarea.** Chosen. Text stays in place, colour per
  token, one scroll box, readable at 45 entries. Cost: caret/scroll/measure sync.
- **B: chip row under the box.** Cheap, but duplicates the list and turns 45 entries
  into a tall second list to scan.
- **C: red values appended to the stat line.** Zero risk, but a wrapped line of
  numbers is hard to pick apart.

## How

- Each textarea is wrapped in `.excl-wrap` (position: relative), which carries the
  surface, border and radius; the textarea becomes transparent with
  `caret-color: var(--text)`, border transparent, and the wrapper gets the focus ring
  via `:focus-within`. Focus styling therefore moves to the wrapper, one rule.
- `.excl-mirror` sits absolutely at inset 0, `pointer-events: none`,
  `user-select: none`, `aria-hidden="true"`, `overflow: hidden`, and carries the same
  font, padding, border width, `white-space: pre-wrap`, `overflow-wrap: break-word`
  and explicit line-height as the textarea. Line-height is set on both (a shared
  value, so the box no longer uses the browser default).
- A pure `exclusionSegments(text, dead)` splits on the same delimiters the parser
  splits on, `[\s,;]+`, but keeps the separators as segments, and flags each content
  segment dead or live. The renderer maps segments to escaped text or
  `<span class="excl-dead">`. Splitting with the separators retained is what keeps
  the mirror byte-identical to the textarea.
- A pure `exclusionMarks(text, parse, cell, rows)` returns
  `{ listed, dead, rows }`; the renderer and the stat line both read it, so the red
  marks and the count cannot disagree.
- Scroll: `ta.addEventListener('scroll', …)` copies `scrollTop`/`scrollLeft` to the
  mirror. Both re-render on `input`, next to the existing save calls.
- The stat line keeps its sentence and appends, only when dead > 0,
  `N unused.` in `var(--danger)`. Existing `--danger: #ff6b6b` is the red; no new
  colour. Red is never the only channel: the count says the same thing in words.
- `parseKreditors`/`parseReferenz` dedupe, so a token listed twice is red twice.
  Nothing is trimmed from the textarea itself.

## Testing

`tests/splitter.test.mjs` (loads the inline script through the existing harness):

- `exclusionMarks` counts per token, sums to the same rows the current stat shows.
- numeric Supplier cells match; `exclusionSegments` keeps separators in order.
- Referenz case-insensitivity, duplicate tokens, blank and whitespace-only tokens.
- A token that matches nothing is dead; an empty list is dead-free and stat-free.
- A dead token that only appears in another column stays dead.

## Version

No bump. The split output is unchanged and the changelog policy exempts how the app
looks and reads. The service worker serves content by URL and needs no `VERSION` bump.

## Open for the builder

- Exact line-height value, as long as both boxes share it.
- Class names and whether the mirror renders through `innerHTML` per segment.
- Whether a resize of the textarea needs a `ResizeObserver` or the wrapper handles it
  (it should, since the mirror is `inset: 0`).
