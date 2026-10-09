#!/usr/bin/env python3
"""Build the local-only Dachser ratecard asset from the two xlsx sources.

Output: assets/dachser-ratecards.js  (gitignored business data).
The shipped, public artifact is the encrypted bundle
assets/dachser-ratecards.enc.json, produced from that plaintext by
scripts/encrypt-dachser-ratecards.mjs.

    python scripts/dachser/build_ratecards.py

Two matrices are emitted, because the Sonderfahrt / bisherigen rule compares
against both:

  NEW  Preismatrix_Dornstadt_International ab 01.07.2026.xlsx
       sheet "Preismatrix Dornstadt", headers row 1, data from row 3.
  OLD  DACHSER_Int. 01.07.24-30.06.26.xlsx
       sheet "Preismatrix Dornst.,Geisl.,Eisl", headers row 11, data from row 13.

Layout (both): column A = "Von" kg, B = "Bis" kg, C = "Staffel" label, and
columns D.. carry one lane each, headed by the country label from the header
row. Each matrix is a list of weight brackets, each bracket a lane->price map.
"""
import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "dachser-ratecards.js"

SHEETS = {
    "new": {
        "path": r"D:\TESTER\Preismatrix_Dornstadt_International ab 01.07.2026.xlsx",
        "sheet": "Preismatrix Dornstadt",
        "header_row": 1,
        "first_data_row": 3,
        "source": "Preismatrix_Dornstadt_International ab 01.07.2026.xlsx",
    },
    "old": {
        "path": r"D:\TESTER\DACHSER_Int. 01.07.24-30.06.26.xlsx",
        "sheet": "Preismatrix Dornst.,Geisl.,Eisl",
        "header_row": 11,
        "first_data_row": 13,
        "source": "DACHSER_Int. 01.07.24-30.06.26.xlsx",
    },
}


def build(spec):
    wb = openpyxl.load_workbook(spec["path"], data_only=True)
    ws = wb[spec["sheet"]]
    heads = {}
    for c in range(1, ws.max_column + 1):
        h = ws.cell(row=spec["header_row"], column=c).value
        if h is not None and str(h).strip():
            heads[c] = str(h).strip()

    brackets = []
    for r in range(spec["first_data_row"], ws.max_row + 1):
        von = ws.cell(row=r, column=1).value
        bis = ws.cell(row=r, column=2).value
        if von is None or bis is None:
            continue
        try:
            von_i, bis_i = int(von), int(bis)
        except (TypeError, ValueError):
            continue
        lanes = {}
        for c, label in heads.items():
            v = ws.cell(row=r, column=c).value
            if isinstance(v, (int, float)):
                lanes[label] = round(float(v), 2)
        brackets.append({"von": von_i, "bis": bis_i, "lanes": lanes})
    return {
        "schema": "dachser-ratecard/v1",
        "source": spec["source"],
        "brackets": brackets,
    }


def emit_js(new_card, old_card):
    lines = []
    lines.append("/* Dachser ratecards - generated from")
    lines.append("     %s" % new_card["source"])
    lines.append("     %s" % old_card["source"])
    lines.append("   by scripts/dachser/build_ratecards.py. Business data: local only,")
    lines.append("   gitignored; the public artifact is assets/dachser-ratecards.enc.json. */")
    lines.append("globalThis.DACHSER_RATECARDS = {")
    lines.append('  schema: "dachser-ratecards/v1",')
    for key, card in (("new", new_card), ("old", old_card)):
        lines.append("  %s: {" % key)
        lines.append("    source: %s," % json.dumps(card["source"]))
        lines.append("    brackets: [")
        for b in card["brackets"]:
            lines.append("      { von: %d, bis: %d, lanes: %s }," % (
                b["von"], b["bis"], json.dumps(b["lanes"], ensure_ascii=False)))
        lines.append("    ],")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    return "\n".join(lines)


def main():
    cards = {}
    for key, spec in SHEETS.items():
        p = Path(spec["path"])
        if not p.exists():
            sys.exit("source workbook not found: %s" % p)
        cards[key] = build(spec)
        print("%-4s %2d brackets, %d lanes in first bracket" % (
            key, len(cards[key]["brackets"]),
            len(cards[key]["brackets"][0]["lanes"]) if cards[key]["brackets"] else 0))
    OUT.write_text(emit_js(cards["new"], cards["old"]), encoding="utf-8")
    print("Wrote %s (%d bytes)" % (OUT, OUT.stat().st_size))


if __name__ == "__main__":
    main()
