# File Splitter — Tariff vs Factual branching

**Date:** 2026-07-03 · **Tool:** `File_splitter.html`

## Goal

Uploaded system files are either **Tariff** or **Factual** work, detected from their
`Step description` column. Tariff files keep the current pipeline (forwarder filter +
note filter). Factual files skip both filters — their rows go straight to the
per-person split. Each type has its **own people list**, and each person gets a
separate output file per type.

## Detection (per file, at upload)

- Find the `Step description` column by exact trimmed header match (same style as
  `pickColumns`).
- Scan its data cells top-down; the first cell matching either keyword decides:
  - contains `tarif` (case-insensitive) → **tariff** (covers "Tariff" and German
    "Tarif…"),
  - contains `factual` or `faktual` (case-insensitive) → **factual**.
- Column missing, or no cell matches either keyword ⇒ **tariff** — identical to
  today's behavior, so current files keep working unchanged.
- One file is one type (per-file classification; mixed files are out of scope).

## Behavior

- **Step 1 (Files):** each valid system card shows a TARIFF or FACTUAL badge next to
  the system name. Factual cards hide the forwarder search + checklist (no forwarder
  filtering); tariff cards are unchanged.
- **Step 2 (People):** two sections — **Tariff people** and **Factual people** — each
  with its own add/remove/Enter-to-add behavior. A section is only shown when at least
  one valid file of that type is loaded. Persistence: the existing
  `fileSplitter.names` key becomes the tariff list (previously saved names carry
  over); factual names save under `fileSplitter.namesFactual`. The skip-blanks and
  shuffle toggles stay global.
- **Step 3 (Notes):** the note checklist tallies tariff systems only; factual rows are
  never note-filtered. Only-factual uploads show the existing "nothing to filter"
  empty state.
- **Step 4 (Split):** two independent balanced splits —
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

- No per-row routing inside one file, no manual type override on a card, no merging of
  a both-lists person into a single workbook, no factual-specific columns (the four
  required headers stay the same for both types).
