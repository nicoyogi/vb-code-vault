#!/usr/bin/env python3
"""Correct Anmerkung cells in the hand-corrected Honold Soll-Ist workbooks.

D:\\TESTER\\Honold\\*.xlsx are the hand-corrected TRUTH. D:\\TESTER\\Before\\*.xlsx
are tool output snapshots and must never be edited here. A "workbook error" is a
row where the engine's phrase is right and the truth file's Anmerkung cell is
wrong; this rewrites that cell so the sheet stops disagreeing with the engine.

    py scripts/honold/fix_workbook.py --date 20261019 --show
    py scripts/honold/fix_workbook.py --date 20261019 --rows 184 --set "Sonderfahrt"
    py scripts/honold/fix_workbook.py --date 20261019 --rows 6,7 --set "..." --dry-run
    py scripts/honold/fix_workbook.py --from-json corrections.json --all --dry-run

The JSON maps a workbook file name to its row corrections:
    {"20379045 Soll-Ist-Vergleich.xlsx": {"6": "phrase", "7": "phrase"}}

--from-json without --all applies the entry for the workbook picked by --date/--file;
with --all it applies every entry in the file, each resolved against TRUTH_DIR and
checked against the Before\\ rule like any other target. A write is refused on a row
whose Stat_Freigabe is not 10 unless --force, because an out-of-scope row carries no
engine phrase to correct it to. A write is also refused when it would drop a ' // '
segment of the current cell - that segment is a human overlay (a Fremdnr note, a named
agreement) or an engine phrase you mean to drop - and prints which segment, unless --force.

Every write copies the workbook into D:\\TESTER\\_backup\\ first, then re-reads the
saved file and refuses to report success unless every cell holds the new text.
The rewrite is openpyxl-based: it drops xl/calcChain.xml and rewrites empty-string
cells as true blanks elsewhere in the book. Both are invisible in Excel and the
backup keeps the original bytes.
"""  # noqa: E501
import argparse
import json
import shutil
import sys
from datetime import datetime
from glob import glob
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter

TRUTH_DIR = Path(r"D:\TESTER\Honold")
BEFORE_DIR = Path(r"D:\TESTER\Before")
DEFAULT_BACKUP = Path(r"D:\TESTER\_backup")
HEADER = "anmerkung"
STAT_HEADER = "stat_freigabe"
HEADER_SCAN_ROWS = 8
# Two header rows (2 and 3) above the data, as every Honold export has.
FIRST_DATA_ROW = 4


def die(msg):
    print("error: " + msg, file=sys.stderr)
    sys.exit(2)


def pick_sheet(wb):
    hits = []
    for name in wb.sheetnames:
        ws = wb[name]
        if find_header_col(ws, HEADER) is not None:
            hits.append(ws)
    if len(hits) != 1:
        die("cannot pick a sheet, "
            f"{len(hits)} of {wb.sheetnames} carry an {HEADER!r} header; pass --sheet")
    return hits[0]


def find_header_col(ws, header):
    hits = []
    for r in range(1, HEADER_SCAN_ROWS + 1):
        for c in range(1, (ws.max_column or 0) + 1):
            v = ws.cell(r, c).value
            if isinstance(v, str) and v.strip().lower() == header:
                hits.append(c)
    if len(hits) > 1:
        die(f"{len(hits)} columns carry an {header!r} header in {ws.title}: "
            f"{[get_column_letter(c) for c in hits]}")
    return hits[0] if hits else None


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
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


def verify_target(path):
    """The truth/Before split, checked on every write target: --file, --date and
    every --all entry, since a JSON file name can walk out of TRUTH_DIR."""
    try:
        path.resolve().relative_to(BEFORE_DIR.resolve())
    except ValueError:
        return path
    die(f"{path} sits under {BEFORE_DIR} (tool output, not truth); "
        f"edit the hand-corrected file in {TRUTH_DIR}")


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
    if path.name.startswith("~$"):
        die(f"{path} is an Excel lock file, not a workbook")
    if not path.exists():
        die(f"no such workbook: {path}")
    return verify_target(path)


def read_jobs(path):
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        die(f"cannot read {path}: {err}")
    if not isinstance(raw, dict):
        die(f"{path} must map a workbook file name to {{row: text}}")
    jobs = {}
    for name, updates in raw.items():
        if not isinstance(updates, dict):
            die(f"{path}: entry {name!r} must be {{row: text}}")
        jobs[name] = {}
        for row, text in updates.items():
            if not str(row).strip().isdigit():
                die(f"{path}: entry {name!r} wants row numbers, got {row!r}")
            jobs[name][int(row)] = "" if text is None else str(text)
    return jobs


def show(ws, col, rows):
    letter = get_column_letter(col)
    todo = rows or [r for r in range(FIRST_DATA_ROW, (ws.max_row or 0) + 1)
                    if ws.cell(r, col).value not in (None, "")]
    for r in todo:
        print(f"{letter}{r}: {ws.cell(r, col).value!r}")


def load_target(path, sheet):
    wb = openpyxl.load_workbook(path)
    ws = wb[sheet] if sheet else pick_sheet(wb)
    col = find_header_col(ws, HEADER)
    if col is None:
        die(f"no {HEADER!r} header in {ws.title}")
    return wb, ws, col


def overlaid_segments(current, new):
    """The ' // ' segments of the CURRENT cell that the new value does not carry.
    Those are the human overlay (a Fremdnr, a named agreement, a second billing) and
    the engine cannot derive them, so a rewrite would delete them silently."""
    if not current:
        return []
    return [seg.strip() for seg in str(current).split(" // ")
            if seg.strip() and seg.strip() not in new]


def fix(path, updates, args):
    if not updates:
        print(f"{path.name}: nothing to change")
        return
    wb, ws, col = load_target(path, args.sheet)
    letter = get_column_letter(col)
    stat_col = find_header_col(ws, STAT_HEADER)
    if stat_col is None and not args.force:
        die(f"no {STAT_HEADER!r} header in {ws.title}; pass --force to write anyway")

    bad = [r for r in updates if r < FIRST_DATA_ROW or r > (ws.max_row or 0)]
    if bad:
        die(f"row(s) outside the data rows {FIRST_DATA_ROW}..{ws.max_row}: {sorted(bad)}")
    for r in sorted(updates):
        if stat_col is None:
            continue
        freigabe = num(ws.cell(r, stat_col).value)
        if freigabe != 10 and not args.force:
            die(f"row {r} has {STAT_HEADER} {ws.cell(r, stat_col).value!r}, not 10; "
                "the engine releases no phrase for it, pass --force to write anyway")
    for r in sorted(updates):
        current = ws.cell(r, col).value
        dropped = overlaid_segments(current, updates[r])
        if dropped and not args.force:
            die(f"row {r}: {updates[r]!r} has segments missing from the new value: {dropped!r} "
                f"(current {current!r}); pass --force if they are engine phrases you mean to drop")

    for r in sorted(updates):
        print(f"{letter}{r}: {ws.cell(r, col).value!r} -> {updates[r]!r}")
    if args.dry_run:
        print(f"dry run, nothing written to {path.name}")
        return

    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"{path.name}.{stamp}.xlsx"
    shutil.copy2(path, backup)

    for r, value in updates.items():
        ws.cell(r, col).value = value
    wb.save(path)

    check = openpyxl.load_workbook(path)[ws.title]
    for r, value in updates.items():
        got = check.cell(r, col).value
        # openpyxl reads a cleared cell back as None, which is the same cell in Excel.
        if (got or "") != value:
            die(f"write did not stick at {letter}{r}: {got!r}")
    print(f"wrote {len(updates)} cell(s) to {path}")
    print(f"backup: {backup}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="sheet date, e.g. 20261019")
    ap.add_argument("--file", help="explicit workbook path (must not be under Before\\)")
    ap.add_argument("--rows", help="row numbers, comma or space separated")
    ap.add_argument("--set", dest="set_value", help="new Anmerkung text")
    ap.add_argument("--from-json", help='{workbook file name: {row: text}}')
    ap.add_argument("--all", action="store_true",
                    help="with --from-json: apply every workbook in the file")
    ap.add_argument("--sheet")
    ap.add_argument("--show", action="store_true", help="print the cells, write nothing")
    ap.add_argument("--dry-run", action="store_true", help="say what would change, write nothing")
    ap.add_argument("--force", action="store_true",
                    help="write a row whose Stat_Freigabe is not 10, or over a cell "
                         "that carries a human overlay")
    ap.add_argument("--backup-dir", default=str(DEFAULT_BACKUP))
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if args.from_json and (args.set_value is not None or args.rows):
        die("--from-json carries its own rows and text; drop --set / --rows")
    if args.all and not args.from_json:
        die("--all applies every workbook in --from-json")

    if args.from_json:
        jobs = read_jobs(args.from_json)
        if args.all:
            targets = [(verify_target(TRUTH_DIR / name), updates)
                       for name, updates in sorted(jobs.items())]
        else:
            path = resolve_file(args)
            if path.name not in jobs:
                die(f"{args.from_json} has no entry for {path.name}")
            targets = [(path, jobs[path.name])]
        for path, updates in targets:
            if not path.exists():
                die(f"no such workbook: {path}")
            fix(path, updates, args)
        return

    path = resolve_file(args)
    rows = parse_rows(args.rows)
    if args.show or args.set_value is None:
        wb, ws, col = load_target(path, args.sheet)
        show(ws, col, rows)
        return
    if not rows:
        die("--rows is required when writing")
    fix(path, {r: args.set_value for r in rows}, args)


if __name__ == "__main__":
    main()
