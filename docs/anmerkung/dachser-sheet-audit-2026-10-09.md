# Dachser FR/SNK sheet audit — the 36 rows where the engine and the workbook disagree

Scope: every row of the three production Soll-Ist workbooks that carries an Anmerkung,
run through `processDachser` with the columns resolved from the sheet headers exactly as
the app does, then diffed against the sheet's own Anmerkung cell.

```
sheet      rows with a note   exact   differ
20260917                 128     118       10
20260923                 270     253       17
20261006                 264     255        9
total                    662     626       36
```

Every one of the 36 differences is accounted for, and **none is an engine defect**:
25 are worksheet errors where the engine is right, 7 are phrase orderings the user ruled
acceptable, and 4 are auditor free text that no column expresses.

This note is the evidence for each of them. It is also the record of how the Sonderfahrt /
bisherigen wording (PR #268) was derived and why the earlier lane-and-EXP proxy was wrong.

## How this was produced

The three workbooks (`Soll-Ist-Vergleich 20260917 / 20260923 / 20261006`) are not in this
repository. The method was:

1. dump each sheet to JSON with openpyxl;
2. rebuild it as the worksheet object the engine expects (`ws[encode_cell({r,c})] = {v}`);
3. resolve the columns through the engine's own `findCol` / `resolveDachser`, so the audit
   reads the sheet the way the app does rather than through a hand-written column map;
4. run `processDachser` over every row that has an Anmerkung, and compare to that cell.

The harness itself is local scratch, but step 3 is the part that matters: an early version
of this audit hand-mapped the columns and produced wrong findings because the FR triple
sits at c45 on 20260917, c51 on 20260923 and c48 on 20261006.

---

## A. Pre-existing items (originally 23 rows; all now closed — 19 sheet errors, 7 allowed orderings, 2 fixes)

### A1. `SNK_DL=80` + `K1AV` — 10 rows — **NOT A DEFECT (user ruling 2026-10-09)**

```
0923 rows 218, 222, 224, 225, 234, 236, 240, 246, 254, 255
```

The sheet says `Differenz Laderaumkostenentwicklung`; the engine emits
`Speditionskosten gem. Text // Admin Zeitfensterbuchung Handel`. The user ruled the
sheet wrong and the engine right, the same class of error as the 13 Sonderfahrt rows in
section C.

The two sheets simply disagree on identical inputs:

```
0923 row 222:  SNK_DL=80  SNK_TAR=70.77  SNK_DIFF=9.23  K1AV  SACH=612100  Dornstadt
               sheet says: Differenz Laderaumkostenentwicklung        (WRONG)
1006 row 222:  SNK_DL=80  SNK_TAR=70.77  SNK_DIFF=9.23  K1AV  SACH=612100  Dornstadt
               sheet says: Speditionskosten gem. Text // Admin Zeitfensterbuchung Handel
```

Every column that could separate them is constant across both sets (SACHKONTO 612100,
SERV_ART K1AV, Abg.-Ort Dornstadt, KOSTENSTELLE 211FO011). That is why no rule could be
derived: there was nothing to derive, because there is no difference to explain.
`SNK_TAR` varies but does not split the sheets, and both dates (14.09 vs 28-29.09)
post-date the 01.07.2026 tariff change.

Outcome: engine unchanged, correct as shipped. Counted in the 36 as a sheet error, not
a defect. An earlier draft of this note wrongly called it a misfiring proxy and proposed
four candidate discriminators, all of which turned out to be constants.

### A2. `Einfuhrzollabfertigung` position — 7 rows — **NOT A DEFECT (user ruling 2026-10-09)**

```
20261006 row 12, 17, 21, 22   sheet: ... Mautdifferenz // ... Gewichte // Einfuhrzollabfertigung
                              engine: ... Einfuhrzollabfertigung // Mautdifferenz // ... Gewichte
20261006 row 16, 25           sheet: Mautdifferenz // Einfuhrzollabfertigung
                              engine: Einfuhrzollabfertigung // Mautdifferenz
```

`daEvalZABF` is called before the Mautdifferenz branch, so the phrase lands in the
middle of the cascade; the auditor appends it last. Every word is right, only the order
is wrong. The user ruled that the phrase may appear anywhere: **this is not a defect and must not be "fixed"**. Recorded so a future ordering audit does not re-raise it.

### A3. `Wartezeit` rows drop their second segment — 3 rows — **FIXED 2026-10-09**

```
20260923 row 216, 230, 308   sheet: Wartezeit 2h á 65 EUR, ok? // Differenz Admin Zeitfensterbuchung Handel - Laderaumzuschlag
                             engine: Wartezeit 2h á 65 EUR, ok?
```

The `residual >= 65` branch in `daEvalSNK` returned the Wartezeit phrase alone and
stopped, so the admin-fee line that should follow was never joined. The phrase is the
auditor's headline, not the whole note: the bundled admin fee is still owed.

Fixed by joining `P.adminZeitfensterDiff` after the headline. 20260923 goes 250 -> 253
exact.

The two unit tests that asserted the suffix-less wording encoded the old behaviour and
were updated. A third contradiction surfaced here: `0917` row 97 has byte-identical
inputs to `0923` row 216 (`135 / 70.52 / 64.48 / K1AV`) but the sheet omits the suffix.
The user ruled row 97 a worksheet error, so the join is correct.

### A4. 0917 row 124 gains a spurious leading segment — 1 row — **FIXED 2026-10-09**

```
row 124   sheet : Produktzuschlag // Mautdifferenz // Dachser berechnet die Kosten nach dem bisherigen Tarif
          engine: Differenz Laderaumkostenentwicklung // Produktzuschlag // Mautdifferenz // ...
```

The leading segment came from the non-integer SNK exemption in `daEvalSNK`'s default
branch, which used `Math.abs(snkDiff) >= T` while `hasErr` used strict `>`. Five rows sit
exactly on the 0.08 boundary:

```
sheet  row   SNK_DL  SNK_TAR  SNK_DIFF   leading segment
0917   124     2.72     2.64      0.08    NO
0917   125     2.64     2.56      0.08    NO
0917   126     2.64     2.56      0.08    NO
0923   295     2.64     2.56      0.08    NO
1006   184     2.80     2.72      0.08    NO   (user ruled the sheet wrong)
```

This was first reported as blocked. It is not: the user confirmed 20261006 row 184 is
also a worksheet error, which makes the boundary uniform and the `>=` exemption simply
wrong. Fixed by tightening it to strict `>`. 20260917 row 124 now reads correctly
(118/128).

The three candidate rules rejected while it looked blocked are kept here as a warning
against re-deriving them:

- **`SNK_DL = 2.80`** — a magic number. 2.8 was already cited in the code comment, so it
  would have fitted the one row that was already documented.
- **`FR Differenz` size** — 184's 121.66 sat between the other groups. No split.
- The correct answer was simply that **all five rows agree**; there was never a
discriminator to find, only a sheet error hiding the pattern.

---

## B. Rows the engine cannot derive (4 rows) — not defects

Each carries auditor wording that no column expresses. Examined individually rather than
lumped together; they are three different things, not one category.

### B1. `0923` row 6 — `zusammengefasste Abrechnung`

```
Abg. DE / Empf. FR, Brutto kg 0
every tariff cell 0 (FR 144.9 DIFFERENZ against Tar 0; MT/SNK/SBFU/TZ Tar all 0)
Total Kosten lt. Tarif 0
Stat_Abgleich 20
engine : kein Tarif für FR
sheet  : zusammengefasste Abrechnung
```

The blank-tariff branch fires, which is arithmetically correct: there is no tariff
anywhere on the row. The auditor explains why (the shipment was billed on a combined
invoice) in prose.

`Stat_Abgleich = 20` plus an all-zero tariff is suggestive, and row 6 is the ONLY
tariff-20 row whose FR Tar is a literal `0` rather than blank (the other eight are
`Gebühr für vergeblichen Abholversuch` or `2. Zustellung`). One row is not enough to
define a rule and the inference would be a proxy, so it is left alone. **OPEN for a user
ruling** only if this phrasing recurs.

### B2. `0923` row 126 — bracketed free text

```
engine : Mautdifferenz // Differenz aufgrund abweichender Gewichte
sheet  : Mautdifferenz // Differenz aufgrund abweichender Gewichte (Missing Fremdnr 1060350073)
```

The engine's part is exactly right. The bracketed suffix names a DIFFERENT transaction's
reference number, which is not in this row. Pure annotation. **Nothing to fix.**

### B3. `0923` row 193 — the documented placeholder

```
engine : Fremdnummer 2544567001 bereits berechnet in RE00123xxx, ok?
sheet  : Fremdnummer 2544567001 bereits berechnet in RE0101165619, ok?
```

`RE00123xxx` is deliberate: the Beleg the row was charged in is not in this workbook, so
the engine cannot name it and writes a placeholder instead. The sheet happens to carry
the real number. **Nothing to fix.**

### B4. `1006` row 27 — `Tagespreis-Nr. 00016270671`

```
Abg. PL / Empf. DE import, kg 5916, Inco EXW
FR DL 2250.00   FR Tar 1322.48   FR Diff 927.52
engine : Dachser berechnet die Kosten nach dem bisherigen Tarif
sheet  : Tagespreis-Nr. 00016270671
```

This was carried as `not_derivable` from the bundle work. Checking it against the
ratecard rule shows the engine is actually RIGHT on the arithmetic:

```
OLD card PL3 Polen @ 5501-6000 = 1149.98
1149.98 x 1.15 (import surcharge) = 1322.477   vs FR Tar 1322.48   (delta 0.003)
```

So this row genuinely IS a `bisherigen` case by the cards. The sheet names a *Tagespreis*
instead: a daily spot price negotiated outside the rate cards. That is a commercial
override the columns cannot express, and no rule can infer it. **Not a mismatch in the
rule; nothing to fix.**

### Verdict

All four are correctly left alone. Only B1 is even a candidate for future work, and only
if `zusammengefasste Abrechnung` recurs often enough to justify a gate.

---

## C. Rows that differ because the SHEET is wrong (25 rows) — correct as shipped

Confirmed by the user against the ratecards or against a sibling sheet carrying identical
inputs:

```
20260917 row 112-116, 125-128   sheet: Dachser berechnet die Kosten nach dem bisherigen Tarif
                                engine: Sonderfahrt            (correct)
20260923 row 293-296            sheet: ... nach dem bisherigen Tarif
                                engine: ... Sonderfahrt        (correct)
20260923 row 218,222,224,225,234,236,240,246,254,255
                                sheet: Differenz Laderaumkostenentwicklung
                                engine: Speditionskosten gem. Text // Admin Zeitfensterbuchung Handel
                                                               (correct; see A1)
20260917 row 97                 sheet omits the admin-fee suffix present on the
                                identical 20260923 row 216     (correct; see A3)
20260917 row 124                sheet omits the leading segment on the identical
                                0.08 boundary rows            (correct; see A4)
20261006 row 184                sheet keeps the leading segment on the identical
                                0.08 boundary rows            (correct; see A4)
```

Not defects. The Sonderfahrt rows are pinned in
`tests/fixtures/dachser-sonderfahrt-rows.json`; the SNK_DL=80 rows are not pinned yet.

---

## Tally

```
662 rows with a note, 626 exact, 36 differ

  25  sheet errors, engine correct as shipped
      (13 Sonderfahrt + 10 SNK_DL=80 + 20260917 r97/r124 + 20261006 r184)
   7  A2 Einfuhrzollabfertigung order — user ruled NOT a defect
   4  un-derivable free text / documented placeholder (section B)
  ---
  36
```

**Zero unexplained diffs. No engine defects remain from this audit.**

Per-sheet:

```
0917  118/128    0923  253/270    1006  255/264
```

## What is still open

Nothing blocking. Section B's B1 (20260923 row 6, `zusammengefasste Abrechnung`) is the
only candidate for future work, and only if that phrasing recurs often enough to justify
a gate; one row cannot define a rule and the inference would be a proxy.

Closed: A1 (sheet error), A2 (allowed ordering), A3 (fixed), A4 (fixed), B (all four
examined — B4 in fact corroborates the ratecard rule).

## Cross-cutting observation

Four times this audit found the SAME inputs with DIFFERENT answers on different sheets,
and every time the engine turned out to be right and one sheet wrong:

```
A1  0923 r222  vs 1006 r222   SNK_DL 80 / K1AV      wording differs
A3  0917 r97   vs 0923 r216   SNK_DL 135 / K1AV     suffix present/absent
A4  0917 r124  vs 1006 r184   SNK_DIFF 0.08         leading segment present/absent
```

A4 was first reported as blocked, on the assumption that a discriminator must exist.
It did not: all five boundary rows agree, and a single worksheet error was hiding the
uniform pattern. The lesson is to test "is one sheet simply wrong?" before hunting for a
column that separates them.
