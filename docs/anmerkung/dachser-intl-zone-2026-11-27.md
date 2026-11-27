# Dachser non-domestic PLZ zones (2026-11-27)

The Referenz count for a non-domestic Dachser row used to read the destination
country's whole lane pool. It now narrows that pool to the row's destination zone
first, using a first-two-digit PLZ table generated into the local-only ratecard
asset. The table is imported knowledge, not a new rule: when it resolves nothing,
the pool is exactly what it was.

Nothing was renamed on the cards and no version was taken. That
is not a claim that the change is invisible: the decision space did move. Two
same-bracket, cross-zone near-pairs are live. FR 301-350 kg: the NEW card prices
`FR Frankreich 1` at 151.38 and the OLD card prices `FR Frankreich 2` at 151.35.
IT 1801-1900 kg: the NEW card prices `IT Italien 1` at 846.23 and the OLD card
prices `IT Italien 2` at 846.20. Each pair sits 0.03 apart, so a tariff copy
between the two prices matches two lanes across the country pool (two
candidates, so silence) while the narrowed zone keeps one, and the uniqueness
gate no longer silences it. PL carries the same shape in several brackets, but
its zone is the bare country code, so nothing narrows there.

No row of the released corpus sits in either window: 2118 released rows over 11
readable workbooks, 0 phrases moved between the engine with the table and the
same engine with `daIntlZone` pinned to null. The policy test is whether an
auditor gets a different result, and on this corpus they do not, so no version
and no changelog entry were taken. The bundle was rebuilt with the team key and
round-trip verified against the plaintext on 2026-11-27, so the table is live;
an auditor would only see a difference on a row that sits inside one of the two
windows above.

## Sources

| Workbook | Path | Role |
| --- | --- | --- |
| `DACHSER ZONE.xlsx`, sheet `Tabelle1` | `D:\TESTER\DACHSER ZONE.xlsx` | authoritative, 122 rows (2 digit PLZ ranges for ES, FI, FR, GR, IT, NO, SE plus 14 whole-country rows) |
| `Zoneneinteilung_national_international_01.07.24.xlsx`, sheet `Gesamt` | `D:\TESTER\Zoneneinteilung_national_international_01.07.24.xlsx` | filler only, 2 digit prefixes the new file does not carry; the domestic DE table comes from the same workbook's `DE` sheet, not from `Gesamt` |

Both are read by `scripts/dachser/build_ratecards.py` (`build_intl_zones`,
`build_intl_old`, `merge_intl_zones`) and land in `assets/dachser-ratecards.js`
under `national`, beside the domestic `plz` table:

- `intl_plz`: country -> prefix -> zone, 8 countries, 798 prefixes
- `intl_whole`: country -> zone for the 14 whole-country rows
- `intl_source`: which workbook decided a country, or `both` where the 2024
  sheet filled a prefix into a country the new file carries (today only IT)

The plaintext asset is gitignored business data. The published encrypted bundle
`assets/dachser-ratecards.enc.json` is untouched by this change; it is rebuilt
only with the team passphrase.

## Precedence

1. A range row in the new file decides that prefix.
2. A whole-country row in the new file covers every prefix of that country, so
   the 2024 sheet adds nothing to it.
3. The 2024 sheet fills only prefixes the new file does not cover at all.

`DE` is excluded from both maps: the domestic ladder owns it, and a domestic row
never reaches this code path.

A row of the 2024 sheet whose `Leitcode` is not exactly two digits is skipped.
That is what drops GB's 124 alphanumeric postcodes and ES's `AD`/`GI`, and it is
why GB is absent from the table while PT's 100 numeric prefixes are present.

## Owner rulings and known gaps

- **GR 28, 29, 31, 49 are GR2.** The 2024 sheet says GR3 for all four; the 2026
  workbook's 20-53 range says GR2, and the owner confirmed GR2. Rule 1 above
  settles it without a special case.
- **IT 86 is IT2.** The 2026 workbook's IT ranges run 00-06, 07-09, 10-48,
  50-85, 87-98, so it carries no 86. The 2024 sheet does, at IT2, and fills it.
  That single prefix is the whole of `intl_source.IT === "both"`.
- **IT 49 and IT 99 are covered by neither workbook.** They stay absent, and the
  builder prints them on every run rather than inventing a zone.
- **PT is in the table but never resolves on a real row.** Portuguese postcodes
  are hyphenated (`4900-350` on 20261105, `3840-385` on 20261013), and the
  lookup accepts only plain digits (`/^\d{2,}$/`), so a PT row fails open to the
  country pool. Accepting the leading two digits was rejected: the PL artefact
  `41-250` (20261013 row 275) would then resolve to a PL zone it must not have.
  The PT entries cost bytes and change nothing until a PT prefix reaches the
  lookup in plain-digit form.
- **`ES3` is unreachable and `Ukraine 01` names no zone; neither card key is
  renamed.** Both return `null` from the parser (no two-letter country head), and
  although `Spanien 3` is priced in all 44 brackets on both cards, no code path
  reaches it, so an ES 07/35/38/52 row always falls back to the country pool and
  a UA row (no workbook carries a UA table) keeps the pool it always had.

## Why the pool filter keeps AT1/AT2, CH1-3, PL1-3

AT, CH and PL are whole-country rows in the new file, so their zone is the bare
country code. The filter matches with `startsWith`, not equality, for two
reasons: the cards put the zone digit in the head (`AT1 Österreich`, `PL3 Polen`)
or in the tail (`FR Frankreich 1`, `ES Spanien 1`), so `daLaneZone` normalises
both orders to one string; and a whole-country zone such as `PL` must keep
`PL1..PL3` rather than none of them. A zone that names no lane of its country
leaves the pool unchanged (fail open), never empty, and the tariff-copy guard
(`daLaneOnLadder`) stays country-wide on purpose.

## Measured effect

Two of the three pool builds in `daReferenzCountIntl` are narrowed: the
Brutto-bracket fit and the second copy-fit at the Volumen kg DL bracket. The
third, the `nl`/`nm` pool of the Sonderfahrt arm, is deliberately left
country-wide: a narrower `nm` could make `nm.length===1` succeed where the
country pool sees two candidates, which would invent a count, while leaving it
wide can only preserve today's silence. Nothing else in the Referenz chain is
touched. Every released row of the local Soll-Ist corpus was audited before and
after with `scripts/dachser/audit_workbook.mjs`:

```
workbooks           12 requested, 11 readable (0101128723 has no Anmerkung column)
released rows       2118 across the 11 readable workbooks
rows with a note    unchanged, and so is every phrase
whole-sheet diff    empty on the 10 dates both runs carry; .agent/artifacts/
                    audit-before.txt against audit-after.txt differs only by the
                    appended 20261105 block, kept as audit-20261105.txt
20261105 diff       empty: .agent/artifacts/audit-20261105-before.txt (engine at
                    1f2d6a0) against audit-20261105.txt
row-level diff      empty on 20261013 29/275, 20260904 6, 20261027 156
```

In other words the table resolves a zone on the corpus rows without ever moving
a count.

## Rebuilding

```
python scripts/dachser/build_ratecards.py
```

It prints the DE prefix count and gaps, then the intl counts, how many prefixes
the 2024 sheet filled, and the prefixes neither workbook carries. The generated
file is byte-identical across runs. `tests/processors.test.mjs` guards the table
itself ("the international zone table follows the owner ruling and the book
precedence"), the narrowing, and the empty-pool fallback.

## Open items

`assets/dachser-ratecards.enc.json` was rebuilt from the plaintext with the team
key on 2026-11-27 and round-trip verified: the ciphertext decrypts to the exact
plaintext, including `national.intl_plz` and the GR ruling. The local plaintext
stays gitignored; only the ciphertext ships. A rebuild is owed whenever either
zone workbook or one of the four price workbooks changes, and nothing detects
that today.

Open with the owner: `DACHSER ZONE.xlsx` states AT, CH and PL as one whole
country each, while both cards price `AT1`/`AT2`, `CH1`-`CH3` and `PL1`-`PL3`
and the 2024 sheet splits them. The precedence above follows the owner's
instruction, so those three countries keep the country pool and the guard is
inert for them; 48 of 48 corpus PL rows whose tariff copy matches a lane price
land on the 2024 sheet's own PL zone. Filling them is a one-line change in
`merge_intl_zones`.
