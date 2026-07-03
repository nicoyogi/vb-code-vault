# File Splitter — Tariff vs Factual branching

**Date:** 2026-07-03 · **Tool:** `File_splitter.html`

## Goal

Uploaded system files are either **Tariff** or **Factual** work, detected from their
`Step description` column. Tariff files keep the current pipeline (forwarder filter +
note filter). Factual files skip both filters — their rows go straight to the
per-person split. Each type has its **own people list**, and each person gets a
separate output file per type.

## Detection (per row, at upload) — revised 2026-07-03

Real exports are **mixed**: the observed `FNP.XLSX` carries 709 × "Tariff Check" and
76 × "Factual Check" rows in one sheet. So classification is per row, and one
uploaded file yields **up to two system entries** (same system name, one `tariff`,
one `factual`) — each with its own step-1 card. Everything downstream operates on
those entries unchanged.

- Find the `Step description` column by exact trimmed header match (same style as
  `pickColumns`).
- A row whose step value contains `factual` or `faktual` (case-insensitive) is
  **factual**; every other row — tariff steps, unknown steps, blank cells, or no
  `Step description` column at all — is **tariff**, identical to today's behavior.
- Empty partitions produce no card; a file whose partitions all extract to zero
  rows still shows one 0-row tariff card so the upload stays visible.
- System-name de-duplication applies per group, so the tariff and factual halves
  of `FNP.XLSX` are both named `FNP`; they never share a workbook, only cards.
- Removing a card removes that partition only (the other half of the file stays).

## Behavior

Wizard order (revised 2026-07-03): **Files → Notes → Totals → People → Split** —
totals come before people so the user can size the team from the surviving row
counts. Notes, Totals, and People unlock once one valid file is loaded; Split
additionally requires a name in every work-type list in use.

- **Step 1 (Files):** each valid system card shows a TARIFF or FACTUAL badge next to
  the system name. Factual cards hide the forwarder search + checklist (no forwarder
  filtering); tariff cards are unchanged.
- **Step 2 (Notes):** the note checklist tallies tariff systems only; factual rows are
  never note-filtered. Only-factual uploads show the existing "nothing to filter"
  empty state.
- **Step 3 (Totals, read-only):** one block per work type in use — total rows
  surviving the current forwarder ticks + note filter (same `splitRows` policy the
  split uses) in large type, with a per-system breakdown underneath. Recomputed every
  time the step is entered, so going back to adjust filters and returning refreshes
  the counts.
- **Step 4 (People):** two sections — **Tariff people** and **Factual people** — each
  with its own add/remove/Enter-to-add behavior. A section is only shown when at least
  one valid file of that type is loaded. Persistence: the existing
  `fileSplitter.names` key becomes the tariff list (previously saved names carry
  over); factual names save under `fileSplitter.namesFactual`. The skip-blanks and
  shuffle toggles stay global.
- **Step 5 (Split):** two independent balanced splits —
  - tariff rows (after forwarder + note + blank filters) across tariff people →
    `Name_Tariff_dd.mm.yyyy.xlsx`, one sheet per tariff system;
  - factual rows (blank filter only) across factual people →
    `Name_Factual_dd.mm.yyyy.xlsx`, one sheet per factual system.
  - A name on both lists gets two files. PRIO marking, shuffle, sheet sorting
    (forwarder A→Z, doc Z→A), styling, and system order (FNP→KSP→OPP→PS1) apply to
    both groups identically.
  - Split (and the wizard's step gating) requires at least one name in every group
    that has valid files; recap chips report rows/people per group.

## Non-goals

- No manual type override on a card, no merging of a both-lists person into a
  single workbook, no factual-specific columns (the four required headers stay the
  same for both types).
