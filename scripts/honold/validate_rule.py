#!/usr/bin/env python3
"""Replay the Honold note rule against a Soll-Ist-Vergleich workbook.

Local evidence tool (the workbook is customer data and is gitignored). It
rebuilds the matrix from the xlsx source with build_tariff.build(), not from
assets/honold-tariff.js: that xlsx is what the browser asset is generated from,
and the engine consumes the generated asset. It prints any row where the rule
disagrees with the workbook's Anmerkung column.

Rule (owner ruling 2026-10-20) supersedes both the weight-tier comparison of
commit 6518ffa and the FR-bracket rule of 29db412: the note is decided from FR
Kosten DL. Volumen kg DL is not read at all, because it is unreliable when
ReferenzNr lists several references. A row keeps "Honold berechnet die Kosten
nach dem bisherigen Tarif" when FR Kosten DL equals an OLD-tariff zone rate
published for its Empf.-Land in the Bis bracket its Volumen kg falls in; every
zone of the country is a candidate (the row carries the country but not the zone,
and no OLD amount sits at two different brackets across the zones of one country),
and the AT tail from 6500 kg up is flat, so one rate sits in eight brackets. A
blank / 0 FR, a missing / 0 Volumen kg, a country the tariff does not publish, or
an FR no zone rate matches reads "Differenz aufgrund abweichender Gewichte".

All three workbook replays agree after the truth cells were corrected to that
rule: 20379045 124/124 (this script), 20381523 41/41 and 20380293 7/7 (the
fixture replay in tests/processors.test.mjs). KNOWN_OUTLIERS is empty and stays
pinned so a future drift cannot pass as expected.

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


def candidates(tariff, fr, land):
    """Bracket indices at which any zone published for `land` equals fr."""
    labels = tariff["codes"].get(str(land or "").strip().upper()) or []
    hits = set()
    for label in labels:
        for i, rate in enumerate(tariff["zones"].get(label) or []):
            if rate is not None and abs(float(rate) - fr) <= RATE_TOL:
                hits.add(i)
    return hits


def predict(tariff, fr, vkg, land):
    """FR is an OLD rate for the row's bracket -> previous tariff, else difference."""
    if fr is None or abs(fr) <= 0:
        return DIFF_NOTE
    tier = tier_idx(tariff["tiers"], vkg)
    if tier is None:
        return DIFF_NOTE
    return OLD_NOTE if tier in candidates(tariff, fr, land) else DIFF_NOTE


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
        if stat != 10:
            # The engine returns null and writes nothing on a gate skip.
            continue
        pred = predict(tariff, fr, vkg, land)
        if pred != truth:
            wrong += 1
            mismatches.append(r)
            print("row %d: truth=%r pred=%r (land=%s fr=%s vkg=%s candidates=%s tier=%s)"
                  % (r, truth, pred, land, fr, vkg,
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
