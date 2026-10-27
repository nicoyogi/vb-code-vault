#!/usr/bin/env python3
"""Replay the Honold note rule against a Soll-Ist-Vergleich workbook.

Local evidence tool (the workbook is customer data and is gitignored). It
rebuilds the matrix from the xlsx source with build_tariff.build(), not from
assets/honold-tariff.js: that xlsx is what the browser asset is generated from,
and the engine consumes the generated asset. It prints any row where the rule
disagrees with the workbook's Anmerkung column.

Rule (1.58.0, supersedes the FR-bracket rule of 29db412 and the weight-tier
comparison of 6518ffa): three notes, decided from FR Kosten DL and FR Kosten
lt. Tarif. FR Kosten lt. Tarif blank / 0 with an Empf.-Land reads
"Kein Tarif für '<LAND>'" and nothing else: the current tariff prices no lane
for that country, so the OLD matrix cannot speak to it. Otherwise the row keeps
"Honold berechnet die Kosten nach dem bisherigen Tarif" when FR Kosten DL equals
an OLD-tariff zone rate published for its Empf.-Land in the Bis bracket its
Volumen kg falls in; every zone of the country is a candidate (the row carries
the country but not the zone, and no OLD amount sits at two different brackets
across the zones of one country), and the AT tail from 6500 kg up is flat, so
one rate sits in eight brackets. That arm suppresses the weight half whatever
Volumen kg DL says (owner ruling 2026-10-20). A second arm joins both phrases:
FR Kosten DL is an OLD amount for the country from ANOTHER bracket, Volumen kg
DL is present in a bracket other than Volumen kg's, and every OLD rate the
country publishes at the billed bracket differs from the row's own FR Kosten
lt. Tarif - a proxy for the current matrix, which is not shipped. A blank / 0
FR, a missing / 0 Volumen kg, a country the tariff does not publish, or an FR no
zone rate matches reads "Differenz aufgrund abweichender Gewichte".

All workbook replays agree after the truth cells were corrected to that rule:
20379045 124/124 (this script), 20381523 41/41, 20380293 7/7 and 20382640 17/17
(the fixture replays in tests/processors.test.mjs). KNOWN_OUTLIERS is empty and
stays pinned so a future drift cannot pass as expected.

This replay reads the 20379045 layout by fixed column index and does not know
the ZZ cost group, so the standalone ZZ branch of processHonold ("2. Zustellung",
see the 20381523 fixture replay) never applies here. Do not point it at
20381523: that sheet has a different layout (no EXP group, a TG group, FR
Kosten DL at column 42).
"""
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "honold"))
import build_tariff  # noqa: E402

OLD_NOTE = "Honold berechnet die Kosten nach dem bisherigen Tarif"
DIFF_NOTE = "Differenz aufgrund abweichender Gewichte"
# The truth's own order: the weight phrase leads, the previous-tariff note follows.
BOTH_NOTE = DIFF_NOTE + " // " + OLD_NOTE
# Empty since the 2026-10-20 ruling and the cell corrections it required: rows 4,
# 44 and 117 (the 2026-10-12 workbook-error list) now agree with the sheet, and the
# 12 cells that had drifted from the FR rule were corrected to it. Pinned so the
# 124/124 evidence cannot shift silently.
KNOWN_OUTLIERS = set()
RATE_TOL = 0.005


def num(v):
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def tier_idx(tiers, kg):
    if kg is None or kg <= 0:
        return None
    for i, t in enumerate(tiers):
        if kg <= t:
            return i
    return len(tiers) - 1


def rates_at(tariff, land, tier):
    """OLD rate each zone of `land` publishes at bracket `tier` (one per zone)."""
    labels = tariff["codes"].get(str(land or "").strip().upper()) or []
    out = []
    for label in labels:
        rates = tariff["zones"].get(label) or []
        if tier is not None and tier < len(rates) and rates[tier] is not None:
            out.append(float(rates[tier]))
    return out


def candidates(tariff, fr, land):
    """Bracket indices at which any zone published for `land` equals fr."""
    labels = tariff["codes"].get(str(land or "").strip().upper()) or []
    hits = set()
    for label in labels:
        for i, rate in enumerate(tariff["zones"].get(label) or []):
            if rate is not None and abs(float(rate) - fr) <= RATE_TOL:
                hits.add(i)
    return hits


def predict(tariff, fr, vkg, vdl, frt, land):
    """The three note rules, in processHonold's order."""
    if fr is None or abs(fr) <= 0:
        return DIFF_NOTE
    land_s = str(land or "").strip().upper()
    frt = 0.0 if frt is None else float(frt)
    if land_s and abs(frt) <= RATE_TOL:
        return "Kein Tarif für '%s'" % land_s
    tier = tier_idx(tariff["tiers"], vkg)
    if tier is None:
        return DIFF_NOTE
    old_at_tier = rates_at(tariff, land_s, tier)
    prev_billed = any(abs(rate - fr) <= RATE_TOL for rate in old_at_tier)
    td = tier_idx(tariff["tiers"], vdl)
    diverged = bool(old_at_tier) and all(abs(rate - frt) > RATE_TOL for rate in old_at_tier)
    prev_dl = (bool(candidates(tariff, fr, land_s)) and vdl is not None and vdl > 0
               and td != tier and diverged)
    if prev_billed:
        return OLD_NOTE
    if prev_dl:
        return BOTH_NOTE
    return DIFF_NOTE


def main():
    wb_path = sys.argv[1] if len(sys.argv) > 1 else r"D:\TESTER\Honold\20379045 Soll-Ist-Vergleich.xlsx"
    xlsx_path = sys.argv[2] if len(sys.argv) > 2 else r"D:\TESTER\Honold OLD Tariff.xlsx"
    tariff = build_tariff.build(xlsx_path)
    ws = openpyxl.load_workbook(wb_path, data_only=True).active
    total = wrong = 0
    mismatches = []
    for r in range(4, ws.max_row + 1):
        truth = ws.cell(r, 63).value
        if not truth:
            continue
        total += 1
        stat = num(ws.cell(r, 34).value)
        land = ws.cell(r, 15).value
        fr = num(ws.cell(r, 45).value)
        vkg = num(ws.cell(r, 31).value)
        vdl = num(ws.cell(r, 32).value)
        frt = num(ws.cell(r, 46).value)
        if stat != 10:
            # The engine returns null and writes nothing on a gate skip.
            continue
        pred = predict(tariff, fr, vkg, vdl, frt, land)
        if pred != truth:
            wrong += 1
            mismatches.append(r)
            print("row %d: truth=%r pred=%r (land=%s fr=%s vkg=%s vdl=%s frt=%s candidates=%s tier=%s)"
                  % (r, truth, pred, land, fr, vkg, vdl, frt,
                     sorted(candidates(tariff, fr, land)) if fr else "-",
                     tier_idx(tariff["tiers"], vkg)))
    unexpected = sorted(set(mismatches) - KNOWN_OUTLIERS)
    print("%d rows, %d mismatches (pinned outliers %s%s)"
          % (total, wrong, sorted(KNOWN_OUTLIERS),
             ", unexpected %s" % unexpected if unexpected else ""))
    if set(mismatches) != KNOWN_OUTLIERS:
        print("FAIL: mismatches are not exactly the pinned outliers")
        sys.exit(1)


if __name__ == "__main__":
    main()
