#!/usr/bin/env python3
"""Regenerate the Honold replay fixtures from the corrected truth workbooks.

    py scripts/honold/build_fixtures.py [workbook dir, default D:\\TESTER\\Honold]

Writes tests/fixtures/honold-{20379045,20381523,20382640}-rows.json. Each row keeps
the cells the engine reads and the workbook's own Anmerkung cell as `truth`; the
replay tests feed both to the real processHonold, so the fixtures are only as
honest as the workbooks behind them. Correct the workbook, then rerun this.

Columns are resolved by header, the way resolveHonold/findCol do it: the row-2
cost-group code plus the row-3 sub-label, first match wins, absent -> no value.
Hard-coded column numbers would read the wrong cell after one inserted column,
which is exactly the kind of silent drift these fixtures exist to prevent.

The workbooks are local-only (gitignored), so a clone cannot regenerate the bytes;
this file is committed so the shape, the column resolution and the row selection
can be reviewed, and so nobody has to hand-edit a truth string again.

Output is deterministic: indent 1, UTF-8, LF, one trailing newline. A second run
is byte-identical.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = r"D:\TESTER\Honold"
FIXTURES = ROOT / "tests" / "fixtures"
TARIFF_JS = ROOT / "assets" / "honold-tariff.js"

# One entry per committed fixture. `whole_sheet` keeps every data row, blank Anmerkung
# included (20382640 is small enough to pin whole, and its Stat_Freigabe 30 rows are
# the null cases); the other two keep only released rows that carry a note.
SPECS = [
    dict(schema="honold-20379045-rows/v1", sheet="20379045 Soll-Ist-Vergleich.xlsx",
         whole_sheet=False, zz=False),
    dict(schema="honold-20381523-rows/v1", sheet="20381523 Soll-Ist-Vergleich.xlsx",
         whole_sheet=False, zz=True),
    dict(schema="honold-20382640-rows/v1", sheet="20382640 Soll-Ist-Vergleich.xlsx",
         whole_sheet=True, zz=False),
]

# (key, row-2 cost-group code, row-3 sub-label), in emission order. The four MT / TG
# keys are the 1.62.0 additions; everything above them predates that change.
COLUMNS = [
    ("stat", "", "Stat_Freigabe"),
    ("fr_dl", "FR", "Kosten DL"),
    ("vkg", "", "Volumen kg"),
    ("land", "", "Empf.-Land"),
    ("zz", "ZZ", "Differenz"),
    ("vkg_dl", "", "Volumen kg DL"),
    ("fr_tarif", "FR", "Kosten lt. Tarif"),
    ("mt_dl", "MT", "Kosten DL"),
    ("mt_tar", "MT", "Kosten lt. Tarif"),
    ("mt_diff", "MT", "Differenz"),
    ("tg_diff", "TG", "Differenz"),
    ("truth", "", "Anmerkung"),
]

DATA_ROW = 4  # rows 2 and 3 are the header pair, row 1 names the block


def header_rows(ws):
    last = ws.max_column
    row2 = []
    row3 = []
    for c in range(1, last + 1):
        v2 = ws.cell(2, c).value
        v3 = ws.cell(3, c).value
        row2.append("" if v2 is None else str(v2).lower())
        row3.append("" if v3 is None else str(v3).lower())
    return row2, row3


def find_col(row2, row3, h2, h3):
    """findCol, mirrored: row-2 code contains h2 (or h2 is empty), row-3 label
    contains h3. Returns the 1-based column, or -1."""
    needle2 = h2.lower()
    needle3 = h3.lower()
    for i in range(len(row3)):
        if (h2 == "" or needle2 in row2[i]) and needle3 in row3[i]:
            return i + 1
    return -1


def tiers():
    # The "Bis" brackets of the OLD tariff. The unit suite reuses this array as
    # REF_TIERS, so it has to stay the tariff's own bracket table rather than a copy.
    text = TARIFF_JS.read_text(encoding="utf-8")
    m = re.search(r"tiers\s*:\s*\[([^\]]*)\]", text)
    if not m:
        raise SystemExit("%s: no tiers array; the fixture needs the tariff's Bis brackets" % TARIFF_JS)
    return [int(v) for v in m.group(1).replace(" ", "").split(",") if v]


def released(stat):
    try:
        return float(stat) == 10
    except (TypeError, ValueError):
        return False


def build(spec, directory, tier_list):
    path = directory / spec["sheet"]
    ws = openpyxl.load_workbook(path, data_only=True).active
    row2, row3 = header_rows(ws)
    cols = {key: find_col(row2, row3, h2, h3) for key, h2, h3 in COLUMNS}
    missing = [k for k in ("stat", "land", "fr_dl", "vkg", "truth") if cols[k] < 0]
    if missing:
        raise SystemExit("%s: header pair not found for %s" % (spec["sheet"], ", ".join(missing)))
    rows = []

    def cell(r, key):
        c = cols[key]
        return None if c < 0 else ws.cell(r, c).value

    for r in range(DATA_ROW, ws.max_row + 1):
        stat = cell(r, "stat")
        truth = cell(r, "truth")
        if stat is None:
            continue
        if spec["whole_sheet"]:
            # A note on an unreleased row is not a rule result, so it is dropped; a
            # blank Anmerkung on a released row stays as truth null (the skip case).
            if truth and not released(stat):
                continue
        elif not truth or not released(stat):
            continue
        row = {"row": r, "stat": stat, "fr_dl": cell(r, "fr_dl"), "vkg": cell(r, "vkg"),
               "land": cell(r, "land")}
        if spec["zz"]:
            row["zz"] = cell(r, "zz")
        row["vkg_dl"] = cell(r, "vkg_dl")
        row["fr_tarif"] = cell(r, "fr_tarif")
        row["mt_dl"] = cell(r, "mt_dl")
        row["mt_tar"] = cell(r, "mt_tar")
        row["mt_diff"] = cell(r, "mt_diff")
        row["tg_diff"] = cell(r, "tg_diff")
        row["truth"] = truth
        rows.append(row)
    return {
        "schema": spec["schema"],
        "source": spec["sheet"],
        "tiers": tier_list,
        # No row is allowed to disagree with the engine: an outlier pinned here would
        # be a test that passes while the rule is wrong.
        "outliers": [],
        "rows": rows,
    }


def main(argv):
    directory = Path(argv[1]) if len(argv) > 1 else Path(DEFAULT_DIR)
    tier_list = tiers()
    for spec in SPECS:
        data = build(spec, directory, tier_list)
        out = FIXTURES / (spec["schema"].split("/")[0] + ".json")
        out.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n",
                       encoding="utf-8", newline="\n")
        print("%s: %d rows, %d bytes" % (out.name, len(data["rows"]), out.stat().st_size))


if __name__ == "__main__":
    main(sys.argv)
