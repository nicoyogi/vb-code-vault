# DHL bundle 2026-11-10: 8 rows, 6 workbook cells, 3 rows left

Scope: the 2026-11-10 DHL bundle, scored against the three truth workbooks in
`D:\TESTER\DHL EXP\`, with columns resolved by the engine's own `resolveDHL` and rows run
through `processDHL`.

```
bundle scan         342   rows the 2026-11-10 bundle scanned
actionable            8   all in STRR000840257, all exact after the change
solved              334   rows the bundle already agreed with
truth cells edited    6   all in STRR000840258
released rows        87   84 agree, 3 differ (the three below)
```

342 / 8 / 334 is the bundle's own `quality.json` (`scanned_rows`, `actionable_rows`,
`by_forwarder.dhl.solved`). 87 is 17 + 12 + 58, the released rows of the three workbooks
recounted by replaying each workbook through `processDHL`; 84 agree is 17 + 12 + 55.

## The 8 bundle rows

All eight sit in `STRR000840257`, where the Anmerkung cell is column BW. `fix_workbook.py`
resolves that column from the header row, so the letter is orientation only. Every one of
the eight carries a negative NX delta and a blocker on the same row, which is the pair the
old code could not produce.

| row | NX delta | AC delta | blocker arms | cell now reads |
| --- | --- | --- | --- | --- |
| 5 | -91.8 | none | FR, OW | `Differenz aufgrund von abweichendem Gewicht/Volumen // Differenz overweight, ok? // Differenz demand surcharge, ok?` |
| 47 | -23.85 | none | FR, YO 15 | `Differenz aufgrund von abweichendem Gewicht/Volumen // Non conveyable piece-weight ok? // Differenz demand surcharge, ok?` |
| 53 | -0.8 | none | FR | `Differenz aufgrund von abweichendem Gewicht/Volumen // Differenz demand surcharge, ok?` |
| 62 | -14 | none | FR, YO 15 | `Differenz aufgrund von abweichendem Gewicht/Volumen // Non conveyable piece-weight ok? // Differenz demand surcharge, ok?` |
| 64 | -55.5 | none | FR, OW | `Differenz aufgrund von abweichendem Gewicht/Volumen // Differenz overweight, ok? // Differenz demand surcharge, ok?` |
| 66 | -0.3 | 11 | FR | `Differenz aufgrund von abweichendem Gewicht/Volumen // Differenz demand surcharge, ok? // Address correction, ok?` |
| 67 | -2.75 | none | FR | `Differenz aufgrund von abweichendem Gewicht/Volumen // Differenz demand surcharge, ok?` |
| 68 | -37.75 | none | FR | `Differenz aufgrund von abweichendem Gewicht/Volumen // Differenz demand surcharge, ok?` |

Row 66 is the one that pins the order: surcharge before address, which is the order the
auditor wrote.

## The 6 corrected cells

`STRR000840258`, Anmerkung column BN.

| rows | before | after |
| --- | --- | --- |
| 56, 62, 74, 139 | `Differenz aufgrund von abweichendem Gewicht/Volumen` | `Differenz aufgrund von abweichendem Gewicht/Volumen // Differenz demand surcharge, ok?` |
| 82, 231 | `Addres Correction, ok?` | `Address correction, ok?` |

Two `fix_workbook.py --set` runs, because `--rows` applies one value to every listed row.
Each run copies the workbook to `D:\TESTER\_backup\` before writing and re-reads the saved
file afterwards, so a silent miss cannot pass as success. The two backups are
`STRR000840258 Soll-Ist-Vergleich.xlsx.20261111-092412.xlsx` and
`STRR000840258 Soll-Ist-Vergleich.xlsx.20261111-092416.xlsx`. A replay of the edited
workbook then prints `released 12 | exact 12 | differ 0`.

Before the edit, the workbook was cell-identical to the tool output recorded in the
2026-11-10 bundle, Anmerkung column included. The `--show` snapshot and the
`20261111-092412` backup agree with
`D:\TESTER\Before\DHL EXP\STRR000840258 Soll-Ist-Vergleich.xlsx` on every one of the 16,962
cells of the used range `A1:BN257` (12,368 of them non-empty), with zero differences. So the
four freight-only cells were the previous engine's own text rather than an auditor's ruling:
nobody had written the surcharge phrase into them, and nobody had dropped it on purpose.

## Why these are cell corrections, not engine exceptions

The note follows the column: NX is the demand surcharge delta and AC is the address
correction delta, so a row that carries either delta earns its phrase whatever else the row
says. Rows 56, 62, 74 and 139 hold a freight delta of their own plus a negative NX delta,
so the surcharge phrase belongs beside the freight note. The engine dropped it only because
a blocker was set, which was the defect, not the row. Rows 82 and 231 carry no blocker at
all and AC = 11, so the only thing that changes there is the spelling of the phrase the
engine already wrote. The non-11 AC arm has no workbook witness either: every non-zero AC
Differenz in the three workbooks is 11 (840257 row 66, 840258 rows 82 and 231), so a unit
test pins that branch.

## The sign split

The corpus holds 15 released rows with a non-zero NX delta, and all 15 fall into one of
three groups:

| workbook | rows | NX sign | blocker on the row |
| --- | --- | --- | --- |
| `STRR000840257` | 8 | negative | yes |
| `STRR000840258` | 4 | negative | yes |
| `STRR000840258` | 3 | positive | no |

A negative delta past `T_DHL` reads `Differenz demand surcharge, ok?` and a positive one
reads `demand surcharge ok?`, on a blocked row or on an open one. NX now reads above the
MT/OS group, so an unblocked row carrying both an NX delta and an MT delta reads the
surcharge before `Mautdifferenz`, where the parent engine read `Mautdifferenz` first; no
workbook row carries that pair, and a unit test pins the order.

Those 15 rows cannot separate sign from blocker as the trigger. Every negative row in the
corpus is blocked and every positive row is not, so the data fits either reading and
nothing in it decides the question. This note claims only what the code does: NX is read
on every released row, and the sign picks the wording. The branch that would settle it, a
positive delta behind a blocker, has no workbook witness at all. A unit test pins it. The
data does not decide it.

## Regression fence

```
regression rows     334   released 21, exact 15, differ 6
```

The six are `c2e4e743`, `c81ed027`, `76636695`, `bc3ed2b2`, `f9740a34` and `6801a10d`,
which are rows 56, 62, 74, 139, 82 and 231 of `STRR000840258`. The recorded snapshot holds
the cell strings from before the workbook edit, so the six are superseded by a truth-cell
correction and are not regressions. Replayed against the edited workbook the same file
reaches `exact 12 / differ 0`.

## What is left

Three rows in `STRR000823340`, all out of scope for this bundle:

- row 191: the sheet names an invoice already billed in another document, `Fremdnummer 1060336861 bereits berechnet in STRR000824970, ok?`; the duplicate-booking arm needs a TARIF cell of 0 or `-` and this row's TARIF is blank, so the engine answers with the freight phrase.
- row 288: the sheet counts a reference across the corpus, `Referenz wird 6x abgerechnet`; no cell on the row carries that count.
- row 302: the sheet ends in a separator with nothing behind it, `Limited quantities ok? //`; the engine writes `Limited quantities ok?`.
