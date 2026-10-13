#!/usr/bin/env python3
"""Correct an Anmerkung cell in a hand-corrected Dachser Soll-Ist workbook.

D:\\TESTER\\Dachser\\*.xlsx are the hand-corrected TRUTH. D:\\TESTER\\Before\\*.xlsx
are tool output snapshots and must never be edited here. A "workbook error" is
a row where the engine's phrase is right and the truth file's Anmerkung cell is
wrong; this rewrites that one cell so the sheet stops disagreeing with the engine.

    py scripts/dachser/fix_workbook.py --date 20261006 --show
    py scripts/dachser/fix_workbook.py --date 20261006 --rows 184 --set "Sonderfahrt"
    py scripts/dachser/fix_workbook.py --date 20260923 --rows 293,294 --set-file phrase.txt

Every write copies the workbook into D:\\TESTER\\_backup\\ first, then re-reads
the saved file and refuses to report success unless the cell holds the new text.
The rewrite is openpyxl-based: it drops xl/calcChain.xml and rewrites empty-string
cells as true blanks elsewhere in the book. Both are invisible in Excel and the
backup keeps the original bytes.
"""  # noqa: E501
import argparse
import shutil
import sys
from datetime import datetime
from glob import glob
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter

TRUTH_DIR = Path(r"D:\TESTER\Dachser")
BEFORE_DIR = Path(r"D:\TESTER\Before")
DEFAULT_BACKUP = Path(r"D:\TESTER\_backup")
HEADER = "anmerkung"
HEADER_SCAN_ROWS = 8


def die(msg):
    print("error: " + msg, file=sys.stderr)
    sys.exit(2)


def pick_sheet(wb):
    hits = []
    for name in wb.sheetnames:
        ws = wb[name]
        if find_anmerkung_col(ws) is not None:
            hits.append(ws)
    if len(hits) != 1:
        die("cannot pick a sheet, "
            f"{len(hits)} of {wb.sheetnames} carry an {HEADER!r} header; pass --sheet")
    return hits[0]


def find_anmerkung_col(ws):
    for r in range(1, HEADER_SCAN_ROWS + 1):
        for c in range(1, (ws.max_column or 0) + 1):
            v = ws.cell(r, c).value
            if isinstance(v, str) and v.strip().lower() == HEADER:
                return c
    return None


def parse_rows(text):
    if not text:
        return []
    out = []
    for part in text.replace(",", " ").split():
        if not part.isdigit():
            die(f"--rows wants row numbers, got {part!r}")
        out.append(int(part))
    return out


def resolve_file(args):
    if args.file:
        path = Path(args.file)
    elif args.date:
        hits = [Path(h) for h in sorted(glob(str(TRUTH_DIR / f"*{args.date}*.xlsx")))
                if not Path(h).name.startswith("~$")]
        if len(hits) != 1:
            names = [h.name for h in hits]
            die(f"--date {args.date}: expected one workbook in {TRUTH_DIR}, "
                f"found {len(hits)} {names}")
        path = hits[0]
    else:
        die("give --date YYYYMMDD or --file PATH")
    if not path.exists():
        die(f"no such workbook: {path}")
    try:
        path.resolve().relative_to(BEFORE_DIR.resolve())
    except ValueError:
        return path
    die(f"{path} sits under {BEFORE_DIR} (tool output, not truth); "
        f"edit the hand-corrected file in {TRUTH_DIR}")


def show(ws, col, rows):
    letter = get_column_letter(col)
    todo = rows or [r for r in range(1, (ws.max_row or 0) + 1)
                    if ws.cell(r, col).value not in (None, "")]
    for r in todo:
        print(f"{letter}{r}: {ws.cell(r, col).value!r}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="sheet date, e.g. 20260923")
    ap.add_argument("--file", help="explicit workbook path (must not be under Before\\)")
    ap.add_argument("--rows", help="row numbers, comma or space separated")
    ap.add_argument("--set", dest="set_value", help="new Anmerkung text")
    ap.add_argument("--set-file", help="read the new text from a UTF-8 file")
    ap.add_argument("--sheet")
    ap.add_argument("--show", action="store_true", help="print the cells, write nothing")
    ap.add_argument("--dry-run", action="store_true", help="say what would change, write nothing")
    ap.add_argument("--backup-dir", default=str(DEFAULT_BACKUP))
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    path = resolve_file(args)
    rows = parse_rows(args.rows)
    wb = openpyxl.load_workbook(path)
    ws = wb[args.sheet] if args.sheet else pick_sheet(wb)
    col = find_anmerkung_col(ws)
    if col is None:
        die(f"no {HEADER!r} header in {ws.title}")
    letter = get_column_letter(col)

    if args.set_file:
        value = Path(args.set_file).read_text(encoding="utf-8").rstrip("\r\n")
    else:
        value = args.set_value

    if args.show or value is None:
        show(ws, col, rows)
        return
    if not rows:
        die("--rows is required when writing")

    bad = [r for r in rows if r < 1 or r > (ws.max_row or 0)]
    if bad:
        die(f"row(s) beyond the sheet ({ws.max_row} data rows): {bad}")

    for r in rows:
        print(f"{letter}{r}: {ws.cell(r, col).value!r} -> {value!r}")
    if args.dry_run:
        print("dry run, nothing written")
        return

    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"{path.name}.{stamp}.xlsx"
    shutil.copy2(path, backup)

    for r in rows:
        ws.cell(r, col).value = value
    wb.save(path)

    check = openpyxl.load_workbook(path)[ws.title]
    for r in rows:
        got = check.cell(r, col).value
        if got != value:
            die(f"write did not stick at {letter}{r}: {got!r}")
    print(f"wrote {len(rows)} cell(s) to {path}")
    print(f"backup: {backup}")


if __name__ == "__main__":
    main()
