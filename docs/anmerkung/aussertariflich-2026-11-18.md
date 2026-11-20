# Außertariflich OK 2026-11-18: 43 released rows, 0 unexpected

Scope: the shipped approval snapshot `assets/aussertariflich.js`, built from
`D:\TESTER\Außertarifliche Transportkosten 20261118.xlsx`, read by the engine's
`approvedReference` / `rowAnmerkung` wrapper, and measured by replaying every `D:\TESTER`
workbook through `rowAnmerkung` (read-only, nothing written, nothing backfilled).

```
sheets in the approval workbook      10   7 carry a Lieferschein / Deliverynote header
distinct references               1,112   every 6..20 digit run, minus the rows of a carrier this tool does
                                          not run, sorted, keys generated/source/refs
10-digit references               1,036   of 1,112, the dominant shape: most of the other 76 are fragments of prefixed ids
                                          (container numbers, SSTR/SHAMS/SRAF references) the digit-run split picks up
rows dropped by the filter           78   100 refs, all DSV / Wiedmann & Winz / Rhenus (see below)
asset bytes                      14,468   assets/aussertariflich.js, generated 2026-11-18
released rows flipped                43   35 Dachser, 1 K+N, 7 Wackler, 0 DHL, 0 Honold
unexpected                            0   no row changed to anything but OK
flips on a blank cell                 0   every flip replaced a note the processor had produced
```

The three sheets without a `Lieferschein` header are `Veranstaltungen PCM 2026`, `Tarife` and
`DPD Selbstanlieferung`; they contribute no reference. DHL Express and Honold carry a
`ReferenzNr` column like the other three forwarders (row 3 on every one of their workbooks), and
the engine reads it, but none of the 717 DHL and 772 Honold references scanned is on the approval
list, so their 3 and 13 workbooks stay at flip 0.

**Correction 2026-11-20.** An earlier revision of this note said DHL Express and Honold expose no
`ReferenzNr` column at all, and the engine comment agreed. That was wrong: the Honold workbook
`20379045 Soll-Ist-Vergleich.xlsx` and the DHL workbook `STRR000840258 Soll-Ist-Vergleich.xlsx`
both carry `ReferenzNr` in row 3, column E. The rule was unreachable for them only because
`resolveDHL` and `resolveHonold` never mapped the column, so `cols.referenz` was undefined and
`approvedReference` returned `''`. Both resolvers now read it, and the Tester has the field. The
measurement behind the zero stands: 717 of 717 DHL rows and 558 of 558 Honold rows carry a
reference (772 of them, some rows bundled), and 0 of both are on the shipped list. Nothing
changes for either forwarder until one appears; the flip totals above are unchanged.

## The carrier filter

The asset may only carry references for forwarders this tool runs. A row is read when its
`Spediteur` / `Forwarding Agency` cell names one of them, and it is dropped when the cell names
a known carrier with no resolver, because nothing downstream could ever match that reference:
the worst it can do is approve a row of a different forwarder for the wrong reason. The
generator derives and prints the table on every run (`extract_aussertariflich.py`):

```
carrier filter: 78 rows dropped, 100 refs dropped
  carrier                       rows  refs
  DSV                             58    59
  Wiedmann & Winz                  8    15
  Rhenus                           7    13
  DSV Air & Sea Germany GmbH       4    17
  Wiedmann & Winz GmbH             1     5
  9 of those refs sit under more than one dropped carrier
```

109 labelled references across the five spellings, 100 distinct: 9 of them also appear on a
second dropped carrier's row. No dropped reference sits on a kept row, so nothing the engine
could still reach was removed.

Two cases stay whole. A sheet with no carrier column at all (`Dachser PCM KW25KW26`, `FTE`)
has no cell to check and is read as before. A cell that is blank or names no carrier either
list knows is also kept: a new spelling of a run forwarder must not silently delete approvals,
so an unknown name keeps its references and the run prints it under `kept with no recognised
carrier` (none today). `Dachser Air` (2 rows) matches on the Dachser keyword and is kept; it is
a Dachser spelling, not another carrier.

## The 43 flips

Every flip is a released (`Stat_Freigabe` 10) row whose note became exactly `OK`. The last
column is what the processor answered before, which is what this release replaces.

### Dachser, 35 rows

| workbook | row | ReferenzNr | note it replaced |
| --- | --- | --- | --- |
| 20261019 | 22 | `2544666780` | `931,15 Kosten für 2.Zustellung etc. ok?` |
| 20261019 | 29 | `2544825471` | `Speditionskosten gem. Text` |
| 20261019 | 46 | `2544825473` | `Speditionskosten gem. Text` |
| 20261019 | 99 | `2545008927` | `Wartezeit 2h á 65 EUR, ok?` |
| 20261019 | 155 | `2544840677` | `1163,45 Kosten für 2.Zustellung etc. ok?` |
| 20261019 | 234 | `2544924890` | `Wartezeit 4h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261019 | 237 | `2544907936` | `Admin Zeitfensterbuchung Handel` |
| 20261019 | 244 | `2544924891` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261019 | 247 | `2544924837` | `Wartezeit 4h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261019 | 252 | `2544907928` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag // Speditionskosten gem. Text // Wartezeit 2h á 65 EUR, ok?` |
| 20261019 | 254 | `2544892015` | `Wartezeit 2h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261019 | 256 | `2544907930` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261019 | 258 | `2544908110` | `Speditionskosten gem. Text // Admin Zeitfensterbuchung Handel` |
| 20261019 | 259 | `2544907924` | `Admin Zeitfensterbuchung Handel` |
| 20261019 | 262 | `2544907904` | `Speditionskosten gem. Text // Admin Zeitfensterbuchung Handel` |
| 20261019 | 263 | `2544924881` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261019 | 277 | `2544969841` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261019 | 281 | `2544969627` | `Wartezeit 3h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261019 | 287 | `2544969649` | `Admin Zeitfensterbuchung Handel` |
| 20261013 | 12 | `2544805654` | `Wartezeit 3h á 65 EUR, ok?` |
| 20261013 | 182 | `2544837835` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261013 | 184 | `2544837743` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261013 | 188 | `2544825471` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261013 | 190 | `2544837856` | `Admin Zeitfensterbuchung Handel` |
| 20261013 | 215 | `2544825473` | `Wartezeit 3h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261006 | 30 | `2544666780` | `Speditionskosten gem. Text` |
| 20261006 | 32 | `2544666766` | `Speditionskosten gem. Text` |
| 20261006 | 41 | `2544666697` | `Speditionskosten gem. Text` |
| 20261006 | 256 | `2544805716` | `Standgeld` |
| 20260923 | 216 | `2544666780` | `Wartezeit 2h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20260923 | 219 | `2544666766` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20260923 | 239 | `2544666697` | `Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag` |
| 20261105 | 191 | `2544975329` | `Wartezeit 2h á 65 EUR, ok?` |
| 20261105 | 193 | `2545097350` | `Wartezeit 4h á 65 EUR, ok?` |
| 20261027 | 4 | `2544837743` | `1099,45 Kosten für 2.Zustellung etc. ok?` |

`20260825`, `20260903`, `20260904`, `20260917` and `20260730` report flip 0; `0101128723`
has no Anmerkung column and is skipped by the replay. `72356649` (K+N) and the other
8 Wackler workbooks report flip 0 as well.

### K+N, 1 row

| workbook | row | ReferenzNr | note it replaced |
| --- | --- | --- | --- |
| 72354874 | 7 | `2543011467` | `Pauschalfracht` |

### Wackler, 7 rows in 7 of 15 workbooks

| workbook | row | ReferenzNr | note it replaced |
| --- | --- | --- | --- |
| 10361841 | 9 | `2544266350` | `Wackler rechnet Frachtrate für 500kg ab` |
| 10362192 | 63 | 8 refs, `2544317110` last | `Avis, ok?` |
| 10362275 | 30 | `2544343670` | `Wackler rechnet Frachtrate für 150kg ab` |
| 10362276 | 6 | `1060325438` | `Pauschalfracht, ok?` |
| 10367543 | 80 | `2544760100` | `NL-10, ok?` |
| 10370017 | 123 | `2545010209` | `Pauschalfracht, ok?` |
| 10373712 | 228 | `2545377992` | `Fremdnummer 2545377992 bereits berechnet in RExxx, ok?` |

## The two bundle witnesses

`10362192` carries two released rows whose `ReferenzNr` cells hold comma-separated delivery
notes, and they are the pair that pins the matching rule:

- row 63: `2544295123,2544295049,2544295304,2544295305,2544295306,2544295308,2544295100,2544317110`.
  All 8 numbers are on the approval list, so the row reads `OK` and its `Avis, ok?` is gone.
- row 67: `2544317142,2544295347,2544295352,2544295180,2544295183,2544295184,2544317156,2544213873`.
  7 of 8 are listed; `2544213873` is absent from the approval workbook, so the row keeps its own
  finding, `hätte gebündelt werden müssen`.

Row 63 is the witness for a full bundle, row 67 for the fail-closed half match. A row whose
cell is `-`, blank, 5 digits or 21+ digits never matches, and a layout with no `ReferenzNr`
column (`cols.referenz < 0`) is never read at all. No workbook in the corpus is such a layout;
that guard is the safety net for one that drops the column.

## The three owner rulings

1. **Terminal override.** A matched released row reads `OK` and nothing else, whatever its
   freight, toll or surcharge lines say. Chosen because the approval is the business ruling on
   the row: a finding printed beside it is noise the auditor has to argue with again. Witness:
   20261019 row 252 carried three findings (`Differenz Admin Zeitfensterbuchung Handel -
   Laderaumzuschlag`, `Speditionskosten gem. Text`, `Wartezeit 2h á 65 EUR, ok?`) and now reads
   `OK`.
2. **Every reference on a bundled row must be listed.** Owner ruling 2026-11-18, superseding
   design section 5 call 2. Chosen to fail closed: a stray or mistyped reference leaves the
   row with today's note instead of claiming an approval that covers only part of the shipment.
   Witness: `10362192` row 63 (8 of 8, flips) against row 67 (7 of 8, does not flip). Cost of
   the ruling as measured: one flip of the 44 the per-shipment reading would have produced.
3. **The approval workbook's own status columns are not gated on.** `Settled` (Amazon),
   `Kosten abgerechnet` (Lagergeld) and `Kosten in € = folgt` (most sheets) record what happened
   to a cost after it was approved: they are filled in later, sometimes never, and a row whose
   cost is still `folgt` is approved for a cost that has not arrived. Chosen because the shipped
   asset holds reference numbers only, and gating on a status column would make the Anmerkung
   change with the bookkeeping rather than with the ruling.

## Refreshing the snapshot

A refreshed approval workbook builds a new asset; nothing else in the engine changes:

```bash
py scripts/anmerkung/extract_aussertariflich.py \
  --xlsx "D:\TESTER\Außertarifliche Transportkosten <date>.xlsx" --generated <YYYY-MM-DD>
```

The output is a pure function of (xlsx bytes, `--generated`), so two runs with the same
arguments produce identical bytes; commit the asset as a `chore(anmerkung):` refresh. The run
prints the kept/dropped carrier table first, so a refresh shows at a glance which carrier fell
out and which name it did not recognise; a carrier that gains a resolver later comes back by
moving its name from `OTHER_CARRIERS` to `RUN_CARRIERS`. A refresh takes **no** version bump
and no changelog entry: it does not change what the tool offers, it changes which rows are on
the list. A refresh that removes a number silently turns yesterday's `OK` rows back into
findings, and a new approval that has not been refreshed yet reads today's note, never a wrong
`OK`.

The asset carries three keys, `generated`, `source` and `refs`. A per-sheet `sheets` map was
considered and dropped on purpose: the sheet titles are customer and project names (`Consumer
Goods`, `Plancha 2025`, `Amazon`, `PCM`, `FTE`), the asset ships in the public bundle, and the
map tells the engine nothing that `refs` does not.

The Tester preset `K+N > Pauschalfracht` uses the reference `9999999999`, a value no approval list
can ever carry, so a refresh cannot quietly turn the demo row into `OK`.

## The audit tools now answer OK

`scripts/dachser/audit_workbook.mjs`, `scripts/wackler/audit_workbook.mjs` and
`scripts/honold/audit_workbook.mjs` load the engine through `tests/harness/load-engine.mjs`,
which now loads `assets/aussertariflich.js` too. They therefore answer `OK` for the rows this
release flips: **43 pre-existing cells** in all, 35 Dachser (`20260923` 3, `20261006` 4,
`20261013` 6, `20261019` 19, `20261027` 1, `20261105` 2), 7 Wackler and 1 K+N (no audit tool
covers K+N; the replay measures it). A full-sheet run prints no `--set` at all: the Dachser and
Honold tools print `--set "OK"` only under `--rows`, and the Wackler tool never prints one.

Those 43 cells are **not** backfilled by this release. The rule is forward-only: an old
workbook keeps the note its engine wrote at the time, and the audit notes under
`docs/anmerkung/` stay as the as-found record. Do not copy that `--set "OK"` flag into
`fix_workbook.py`; it would rewrite a past invoice's annotation, which is exactly what this
release does not do.

## Verification

- `npm test`: 703 tests, 703 pass, 0 fail, 0 skipped with the plaintext rate cards present.
  A clone without them reports 692 passed, 11 skipped.
- `npm run verify:anmerkung`: all PASS.
- Replay of the 11 Dachser dailies, 2 K+N workbooks, 15 Wackler workbooks, 3 DHL workbooks and
  13 Honold workbooks: `flip 43, unexpected 0`, 35 Dachser / 1 K+N / 7 Wackler / 0 DHL / 0 Honold.
- `resolveDHL` and `resolveHonold` resolve the `ReferenzNr` column on all 3 and all 13 of their
  workbooks (the correction above); the auto-detect score rises by 1 for each of them on every
  sheet and no sheet's detected forwarder changes.
- Every one of the 43 references that a flip depends on is still in the asset after the carrier
  filter: diffing the old and new reference sets gives 100 removed, 0 added, 0 flip references
  missing.
- `grep -n "const VERSION" sw.js` still reads `v1.7.5`: this release adds content, not service
  worker logic.
