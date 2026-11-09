# Honold bundle 2026-11-09: 18 rows, 4 not derivable, 56 workbook cells

Scope: the 2026-11-09 Honold bundle, scored against the ten truth workbooks in
`D:\TESTER\Honold\`, with columns resolved by the engine's own `resolveHonold` and rows run
through `processHonold`.

```
bundle rows          18   14 derivable, 4 in the ledger
truth cells edited   56   across 8 workbooks
released rows       215   211 agree, 4 differ (the ledger rows below)
bundle scan         345   rows the 2026-11-09 bundle scanned, 341 agreeing after the edits
```

215 is the corpus: the released rows of the ten workbooks under `D:\TESTER\Honold\`, recounted
with `scripts/honold/audit_workbook.mjs`. The toll arm is terminal, so the four ledger rows
below are the only differences left and 20384083 NEU row 6 agrees (see Precedence). The
345 / 341 pair is the bundle's own scan of the rows it shipped with, not the corpus.

Numbers: the 345 / 18 / 327 split is the bundle's own `quality.json` (`scanned_rows` /
`actionable_rows` / `solved`), and 341 is 327 plus the 14 derivable rows. The 56 cells come
from a diff of the ten `D:\TESTER\Honold\` workbooks against `D:\TESTER\_backup\`, across
8 workbooks. The 50 / 95 TG-tariff counts are an aggregation over a
dump of the ten workbooks. `211 agree` is 210 rows with a note plus 1 row empty on both
sides (20382640 NEU row 11), which is why `audit_workbook.mjs` prints `exact 210 / blank 1`.
Recount the corpus with `--file`, because `--date 20381523` and `--date 20382640` each match
two workbooks. For one row, `node scripts/honold/audit_workbook.mjs --file <workbook>
--rows <n>` prints the sheet cell, the engine phrase, and the `--set` string; `npm test`
and `npm run test:anmerkung` print the suite counts.

## The 18 bundle rows

14 now read what the auditor wrote: 10 on the toll and Tauschgebühr rules, 1 on the
freight floor, and 3 more (bb749a9b, eb89205b, 992e927d) that agree once their truth cell is
corrected.

The other 4 stay wrong by design: nothing on the row expresses what the cell says.

| row_uid | row | what the truth cell adds |
| --- | --- | --- |
| `84e2169c` | 20381523 NEU row 44 | `Fremdnr 2544936940, 2544936914 nur in PDF nicht in CSV`: two invoice numbers on no cell of the row. |
| `a88eb23d` | 20383038 NEU row 67 | `Fracht wird 2x abgerechnet; lt Honold wie mit Frau Lang vereinbart 1575 EUR extra // Differenz star service`: a count and a named agreement, neither carried by a column. |
| `4185cb39` | 20383038 NEU row 153 | `Fremdnr 2544962354 nur in PDF nicht in CSV`: one invoice number, not on the row. |
| `ef059c12` | 20384083 NEU row 22 | `Fremdnr 1060379995 nur in PDF nicht in CSV`: same. |

Rows 67 and 153 still had their cell edited for the engine half; the free text stayed.

## The 56 corrected cells

One witness per workbook, the string the row reads after the edit:

- `20379045`, 28 cells: rows 6-12, 16-21, 32, 33, 57, 59, 88, 96, 97, 98, 100, 102, 104,
  105, 117, 118, 127. Witness row 7: `Honold berechnet die Kosten nach dem bisherigen
  Tarif // Differenz Tauschgebühr, ok?`
- `20381523` Oct-19, 9 cells: rows 6, 7, 9, 12, 16, 17, 18, 27, 28. Witness row 6: the same
  previous-tariff plus Tauschgebühr string.
- `20382640` Oct-27, 6 cells: rows 4, 7, 9, 12, 13, 16. Witness row 7: `Differenz aufgrund
  abweichender Gewichte // Honold berechnet die Kosten nach dem bisherigen Tarif //
  Mautdifferenz // Differenz Tauschgebühr, ok?`
- `20382640` NEU, 4 cells: rows 7, 12, 13, 14. Witness row 7: `Differenz aufgrund
  abweichender Gewichte // Mautdifferenz // Differenz Tauschgebühr, ok?`
- `20381521` NEU, 3 cells: rows 9, 16, 19. Witness row 9: the same three-phrase string.
- `20384083` NEU, 3 cells: rows 4, 7, 9. Witness row 7: `Differenz aufgrund abweichender
  Gewichte // Mautdifferenz // Differenz Tauschgebühr, ok?`
- `20383038` NEU, 2 cells: rows 67, 153. Witness row 153: `Differenz aufgrund abweichender
  Gewichte // Differenz Tauschgebühr, ok? // Fremdnr 2544962354 nur in PDF nicht in CSV`
- `20380811` NEU, 1 cell: row 56. `Honold berechnet die Kosten nach dem bisherigen Tarif //
  Differenz Tauschgebühr, ok?`

## Precedence, one witness row each

| witness | what it pins |
| --- | --- |
| 20382640 Oct-27 row 8 (`SI`) | FR Kosten lt. Tarif 0 and MT Kosten lt. Tarif 0 with 48.52 of toll billed: the row reads `Kein Tarif für 'SI'`, so the FR arm still returns before the toll phrase. |
| 20384083 NEU row 6 (`LT`) | FR Kosten DL 83.77 is the LT rate of the 200 kg bracket its Volumen kg 183 sits in, so the previous-tariff arm would otherwise fire, and MT Kosten lt. Tarif is 0 with 10.71 billed. The auditor wrote `Kein Maut Tarif für 'LT'` and nothing else, so the toll arm is terminal: on the only row where both notes were derivable the auditor wrote the toll phrase alone, which is positive evidence that it suppresses the freight note, and RUL2 fixes that as the rule. |
| 20382640 NEU row 11 | FR 88.62 against tariff 88.51 (0.11): the cell is empty, so the floor silences the fallback weight phrase. |
| 20379045 row 7 | A previous-tariff base plus `Differenz Tauschgebühr, ok?`: an additive arm joins a claimed phrase instead of replacing it. |

Terminality is falsifiable: a later cell that carries both phrases means the arm is wrong
for that row, so make it additive and add that row as the witness.

## Notes for the next maintainer

- `Mautdifferenz` is one-sided on purpose: only an MT Differenz below `-HONOLD_RATE_TOL`
  fires, so a toll line billed ABOVE its tariff is not a finding. Dachser, DHL and Wackler
  test both signs with `hasErr`; Honold does not. The witness is 20384083 NEU row 22, MT
  29.45 against 26.99, a +2.46 delta the engine leaves unflagged. Do not "fix" it to
  `hasErr`. It cannot co-occur with the terminal toll phrase: an MT tariff of about 0 makes
  that row's MT Differenz positive, so the terminal arm takes the row first.
- The billed Tauschgebühr is the tariff times 1.11 on all 50 released CH rows that carry a
  TG tariff (delta 0.11 x tariff), and equals it on the 95 AT and CZ rows that carry one. So
  `Differenz Tauschgebühr, ok?` maps onto the destination country for CH and carries no
  per-row signal until the CH clause is settled. The 1.11 factor is UNVERIFIED: it is a
  contract or tariff question, not something the code can decide. It is additive on the
  freight verdict and sits last, so it never appears beside either terminal phrase: a row
  the FR no-tariff arm or the untariffed-toll arm takes returns before it.
- The engine replaces the Anmerkung cell on every released row, so the four overlay rows
  (Fremdnr / star party / 2x abgerechnet) survive only because nobody re-runs the tool over
  a truth workbook. Tool output belongs in `Before\`, never in `Honold\`, and
  `fix_workbook.py` refuses a write that would drop a ` // ` segment unless `--force`.

## Constants

| constant | value | corpus bound |
| --- | --- | --- |
| `HONOLD_RATE_TOL` | 0.005 | Half a cent. The OLD matrix carries 4-decimal values on the GB Großbrittanien 2 column while the rest is whole cents, so equality has to tolerate half a cent. |
| `HONOLD_FR_FLOOR` | 0.5 | Inside the measured window [0.11, 0.64): 4.5x the largest dust and 7.5x below the smallest legitimate difference, 3.74. |

## Counts

```
npm test                668 tests, 668 pass, 0 fail, 0 skip
npm run test:anmerkung  355 tests, 355 pass, 0 fail, 0 skip
```

10 of the 668 need a local plaintext asset (4 Honold workbook replays, 6 Dachser card
tests), so a clone with neither reports 658 passed, 10 skipped.
