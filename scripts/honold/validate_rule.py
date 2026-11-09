#!/usr/bin/env python3
"""Replay the Honold note rule over a Soll-Ist-Vergleich workbook and count disagreements.

Local evidence tool (the workbooks are customer data and stay on disk). It rebuilds the
OLD tariff from its xlsx source with build_tariff.build(), finds every column from the
sheet's own two header rows the way resolveHonold does, and runs the whole cascade over
every data row. A row whose Anmerkung cell is blank is counted too, so an overfire (a
phrase the sheet does not carry) cannot hide behind the old "if not truth: continue".

    py scripts/honold/validate_rule.py "D:\\TESTER\\Honold\\20380293 Soll-Ist-Vergleich.xlsx"

Cascade, in processHonold's order. Any Stat_Freigabe other than 10 releases nothing (the
engine returns null). Five notes:
  1. Blank / 0 FR Kosten DL: "2. Zustellung" when the ZZ Differenz clears T_DACHSER,
     otherwise "Differenz aufgrund abweichender Gewichte".
  2. FR Kosten lt. Tarif blank / 0 with an Empf.-Land: "Kein Tarif für '<LAND>'",
     terminal, before the Volumen kg gate and the floor.
  3. MT Kosten lt. Tarif blank / 0 while MT Kosten DL clears T_DACHSER: "Kein Maut Tarif
     für '<LAND>'", terminal and after the FR arm. RUL2 makes it terminal because on the
     only row where both notes were derivable the auditor wrote the toll phrase alone, so
     it replaces a freight verdict rather than joining it.
  4. FR Kosten DL equals an OLD rate for the country at the bracket its Volumen kg falls
     in: "Honold berechnet die Kosten nach dem bisherigen Tarif".
  5. The same amount from another bracket, with the row's own tariff cost diverged:
     both phrases.
Then the tail:
  - the FR materiality floor turns the plain weight phrase into '' when the tariff cell
    holds a price and |FR - FR lt. Tarif| <= HONOLD_FR_FLOOR. It never eats a claimed
    phrase, and a blank / 0 tariff cell keeps the weight phrase.
  - MT Differenz < -HONOLD_RATE_TOL joins "Mautdifferenz", then TG Differenz outside
    T_DACHSER joins "Differenz Tauschgebühr, ok?".

Tolerances: HONOLD_RATE_TOL 0.005 (the OLD matrix carries four decimals on a few lanes,
so equality is a half cent), T_DACHSER 0.08 (the "is there a charge at all" tester, which
the TG arm also uses), HONOLD_FR_FLOOR 0.5 (the FR materiality window).

A NEU sheet carries human overlays: free text the engine cannot derive (a named
agreement, a second billing, a Fremdnummer only in the PDF). Those rows are expected to
show as mismatches, and correcting the cell is the wrong move there. A workbook whose
truth cells simply predate the current rule shows mismatches for the same reason: they
are findings, not exemptions, which is why KNOWN_OUTLIERS stays empty.

Exit 1 when the mismatches are not exactly the pinned outliers.
"""
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "honold"))
import build_tariff  # noqa: E402

DEFAULT_WORKBOOK = r"D:\TESTER\Honold\20379045 Soll-Ist-Vergleich.xlsx"
DEFAULT_TARIFF = r"D:\TESTER\Honold OLD Tariff.xlsx"

OLD_NOTE = "Honold berechnet die Kosten nach dem bisherigen Tarif"
DIFF_NOTE = "Differenz aufgrund abweichender Gewichte"
ZZ_NOTE = "2. Zustellung"
MAUT_DIFF = "Mautdifferenz"
TG_DIFF = "Differenz Tauschgebühr, ok?"

HONOLD_RATE_TOL = 0.005
T_DACHSER = 0.08
HONOLD_FR_FLOOR = 0.5

# The header rows the app reads: row 2 carries the cost group, row 3 the sub-label.
HEADER_ROWS = (2, 3)
DATA_START_ROW = 4
# Empty since the 2026-10-20 ruling and the cell corrections it forced. Pinned so a
# regression cannot pass as expected drift.
KNOWN_OUTLIERS = set()

COLS = {
    "target": ("", "Anmerkung"),
    "stat": ("", "Stat_Freigabe"),
    "fr_dl": ("FR", "Kosten DL"),
    "zz": ("ZZ", "Differenz"),
    "vkg": ("", "Volumen kg"),
    "vkg_dl": ("", "Volumen kg DL"),
    "fr_tar": ("FR", "Kosten lt. Tarif"),
    "mt_dl": ("MT", "Kosten DL"),
    "mt_tar": ("MT", "Kosten lt. Tarif"),
    "mt_diff": ("MT", "Differenz"),
    "tg_diff": ("TG", "Differenz"),
    "empf_land": ("", "Empf.-Land"),
}


def find(ws, h2, h3):
    """mirror of findCol: first column whose row 3 carries h3 and row 2 carries h2."""
    needle2 = (h2 or "").lower()
    needle3 = h3.lower()
    for c in range(ws.max_column or 0):
        v2 = ws.cell(HEADER_ROWS[0], c + 1).value
        v3 = ws.cell(HEADER_ROWS[1], c + 1).value
        row2 = "" if v2 is None else str(v2).lower()
        row3 = "" if v3 is None else str(v3).lower()
        if (not needle2 or needle2 in row2) and needle3 in row3:
            return c
    return -1


def num(v):
    """parseLocaleNumber (assets/anmerkung.js:716): a cell can hold German text like
    "1.234,56", which a bare comma swap reads as 1.234. Thousands drop on the later
    separator, and a parenthesised value is negative."""
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = "".join(str(v).replace("\u00a0", " ").split())
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    s = re.sub(r"[^0-9,.+\-]", "", s)
    has_comma, has_dot = "," in s, "." in s
    if has_comma and has_dot:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".", 1)
        else:
            s = s.replace(",", "")
    elif has_comma:
        s = s.replace(",", ".")
    try:
        n = float(s)
    except ValueError:
        return None
    return -abs(n) if neg else n


def cellnum(ws, r, c):
    """cellNum: a missing column or an unreadable cell reads 0, never raises."""
    if c < 0:
        return 0.0
    v = num(ws.cell(r, c + 1).value)
    return 0.0 if v is None else v


def cellstr(ws, r, c):
    if c < 0:
        return ""
    v = ws.cell(r, c + 1).value
    return "" if v is None else str(v).strip()


def has_err(v):
    return abs(v) > T_DACHSER


def join(a, b):
    if not b:
        return a
    if b.lower() in a.lower():
        return a
    return (a + " // " + b) if a else b


def tier_idx(tiers, kg):
    if kg is None or kg <= 0:
        return None
    for i, t in enumerate(tiers):
        if kg <= t:
            return i
    return len(tiers) - 1


def predict(tariff, ws, r, cols):
    """processHonold for row r; None when the row is out of scope."""
    if cols["stat"] >= 0 and cellnum(ws, r, cols["stat"]) != 10:
        return None
    fr = cellnum(ws, r, cols["fr_dl"])
    if not abs(fr) > 0:
        if cols["fr_dl"] >= 0 and cols["zz"] >= 0 and has_err(cellnum(ws, r, cols["zz"])):
            return ZZ_NOTE
        return DIFF_NOTE
    land = cellstr(ws, r, cols["empf_land"]).upper()
    frt_ok = cols["fr_tar"] >= 0
    frt = cellnum(ws, r, cols["fr_tar"])
    if frt_ok and land and abs(frt) <= HONOLD_RATE_TOL:
        return "Kein Tarif für '%s'" % land
    if (cols["mt_tar"] >= 0 and cols["mt_dl"] >= 0 and land
            and abs(cellnum(ws, r, cols["mt_tar"])) <= HONOLD_RATE_TOL
            and has_err(cellnum(ws, r, cols["mt_dl"]))):
        return "Kein Maut Tarif für '%s'" % land
    tv = tier_idx(tariff["tiers"], cellnum(ws, r, cols["vkg"]))
    if tv is None:
        return DIFF_NOTE
    labels = tariff["codes"].get(land) or []
    prev_billed = False
    old_anywhere = False
    old_at_tv = []
    for label in labels:
        rates = tariff["zones"].get(label) or []
        if tv < len(rates) and rates[tv] is not None:
            rate = float(rates[tv])
            if abs(rate - fr) <= HONOLD_RATE_TOL:
                prev_billed = True
            old_at_tv.append(rate)
        if any(x is not None and abs(float(x) - fr) <= HONOLD_RATE_TOL for x in rates):
            old_anywhere = True
    vdl = cellnum(ws, r, cols["vkg_dl"])
    td = tier_idx(tariff["tiers"], vdl)
    diverged = frt_ok and bool(old_at_tv) and all(
        abs(v - frt) > HONOLD_RATE_TOL for v in old_at_tv)
    prev_dl = old_anywhere and vdl > 0 and td != tv and diverged
    if prev_billed:
        res = OLD_NOTE
    elif prev_dl:
        res = join(DIFF_NOTE, OLD_NOTE)
    elif frt_ok and abs(frt) > HONOLD_RATE_TOL and abs(fr - frt) <= HONOLD_FR_FLOOR:
        res = ""
    else:
        res = DIFF_NOTE
    if cols["mt_diff"] >= 0 and cellnum(ws, r, cols["mt_diff"]) < -HONOLD_RATE_TOL:
        res = join(res, MAUT_DIFF)
    if cols["tg_diff"] >= 0 and has_err(cellnum(ws, r, cols["tg_diff"])):
        res = join(res, TG_DIFF)
    return res


def main():
    wb_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_WORKBOOK
    xlsx_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_TARIFF
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    tariff = build_tariff.build(xlsx_path)
    ws = openpyxl.load_workbook(wb_path, data_only=True).active
    cols = {name: find(ws, h2, h3) for name, (h2, h3) in COLS.items()}
    if cols["target"] < 0:
        print("error: no Anmerkung column in %s" % ws.title, file=sys.stderr)
        return 2

    released = noted = 0
    mismatches = []
    for r in range(DATA_START_ROW, (ws.max_row or 0) + 1):
        pred = predict(tariff, ws, r, cols)
        if pred is None:
            continue
        released += 1
        truth = str(ws.cell(r, cols["target"] + 1).value or "").strip()
        if truth:
            noted += 1
        if pred == truth:
            continue
        mismatches.append(r)
        print("row %d: truth=%r pred=%r (land=%s fr=%s frt=%s vkg=%s vdl=%s mtdiff=%s tgdiff=%s)"
              % (r, truth, pred, cellstr(ws, r, cols["empf_land"]),
                 cellnum(ws, r, cols["fr_dl"]), cellnum(ws, r, cols["fr_tar"]),
                 cellnum(ws, r, cols["vkg"]), cellnum(ws, r, cols["vkg_dl"]),
                 cellnum(ws, r, cols["mt_diff"]), cellnum(ws, r, cols["tg_diff"])))
    print("%s: %d released, %d noted, %d mismatches (pinned outliers %s)"
          % (Path(wb_path).name, released, noted, len(mismatches), sorted(KNOWN_OUTLIERS)))
    if set(mismatches) != KNOWN_OUTLIERS:
        print("FAIL: mismatches are not exactly the pinned outliers")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
