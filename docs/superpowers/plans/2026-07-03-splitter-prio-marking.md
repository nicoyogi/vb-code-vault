# Plan — splitter PRIO marking + fixed system order

Spec: `docs/superpowers/specs/2026-07-03-splitter-prio-marking-design.md`

1. **Pure helpers** in `File_splitter.html` (top-level, vm-testable):
   `normDoc(v)`, `systemRank(name)` over `SYSTEM_ORDER = ['FNP','KSP','OPP','PS1']`,
   `prioDocsFromSheet(sheet)` — sparse cell walk keyed on `Dokumentnummer` /
   `Document number` header cells.
2. **State + UI:** `prio = { fileName, docs:Set } | null`; picker row in step 1
   (`#prioInput`, `#prioBtn`, `#prioClear`, `#prioLabel`), `handlePrioFile` /
   `renderPrio`.
3. **Ordering:** `systems.sort(byRank)` after each upload in `handleFile` — cards,
   recap, and output sheets all read from `systems`.
4. **Write path** in `splitFile`: header gains `PRIO` column when `prio` set; matching
   rows get `PRIO` text; `PRIO_STYLE` (yellow fill + borders) on doc + PRIO cells;
   widths/autofilter ranges follow `header.length`.
5. **Recap chip:** count matches over the already-filtered rows.
6. **Tests:** stub `XLSX.utils.decode_cell` in `tests/harness/load-splitter.mjs`;
   add `systemRank` + `prioDocsFromSheet` + `normDoc` cases to
   `tests/splitter.test.mjs`. Run `node --test "tests/*.test.mjs"`.
7. **Verify in browser:** serve repo, drop synthetic FNP/KSP/OPP/PS1 files + the real
   PRIO workbook via DataTransfer, split, re-parse a generated blob with
   `XLSX.read(..., {cellStyles:true})`, assert sheet order, PRIO column and fills.
