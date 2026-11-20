#!/usr/bin/env python3
"""Build assets/aussertariflich.js from the out-of-tariff approval workbook.

The list is the approval side of the carrier's
"Außertarifliche Transportkosten" sheet: every delivery-note number on it has
already been agreed, so a row carrying one reads `OK` instead of a finding.

Only the Lieferschein/Deliverynote cell is read; cost, date and customer
columns are never touched, so the asset stays a plain list of references. The
cell is not always a bare number: 74 of the shipped entries come out of cells
that mix letters and digits, such as the container serial `UASU1012094`
(-> 1012094) or the fragment `SSTR0438318` (-> 0438318), so every digit run of
REF_MIN to REF_MAX characters in the cell is a candidate reference.

A row is read only when its carrier column (Spediteur / Forwarding Agency)
names a forwarder this tool has a resolver for, or when that cell is blank or a
name the two lists below do not know. An unknown name is kept rather than
guessed away: a new spelling of a run forwarder must not silently delete
approvals, and every run prints it for review. A row naming a known carrier
without a resolver is dropped, because its reference can only approve a row of
another forwarder. The dropped carriers are printed with their row and
reference counts on every run.

    py scripts/anmerkung/extract_aussertariflich.py \\
        --xlsx "D:\\TESTER\\Außertarifliche Transportkosten 20261118.xlsx" \\
        --generated 2026-11-18
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

import openpyxl

HEADERS = ("lieferschein", "deliverynote")
CARRIER_HEADERS = ("spediteur", "forwarding agency")
HEADER_ROWS = 15
# 6 is the shortest reference the workbook carries (the shipped list holds six-digit
# numbers). A shorter run is not a quantity: the 5-digit runs the split drops are
# fragments of compound ids ('PBL00022' -> '00022', '2540532715.25405' -> '25405'),
# so the threshold filters on id shape, not on screening out counts.
REF_MIN, REF_MAX = 6, 20

# The five forwarders the engine runs (processDachser, processWackler, processKN,
# processDHL, processHonold), as they are spelled in the workbook, matched as
# keywords so legal forms and umlauts do not need a line each. A carrier listed
# here but absent from a refreshed workbook is not an error: the table prints what
# was actually seen.
RUN_CARRIERS = ("dachser", "wackler", "kuehne", "k+n", "dhl", "honold")
# Carriers the engine has no resolver for. Their rows are dropped; a name in
# neither list is kept, so a new spelling of a run forwarder cannot silently
# delete approvals, and the printed table shows it for review.
OTHER_CARRIERS = ("dsv", "rhenus", "wiedmann")
UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
                        "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"})


def find_header(ws, names):
    """The cell carrying one of the `names` headers, or None."""
    for row in ws.iter_rows(min_row=1, max_row=HEADER_ROWS):
        for cell in row:
            if cell.value is not None and str(cell.value).strip().lower() in names:
                return cell
    return None


def carrier_kind(cell):
    """run, other, unknown or blank for one carrier cell."""
    name = " ".join(re.sub(r"[^a-z0-9&+]", " ", str(cell or "").translate(UMLAUTS).lower()).split())
    if not name:
        return "blank"
    if any(k in name for k in RUN_CARRIERS) or re.search(r"\bkn\b", name):
        return "run"
    if any(k in name for k in OTHER_CARRIERS):
        return "other"
    return "unknown"


def sheet_rows(ws, header, carrier):
    """Yield (carrier cell, [ref tokens]) for every row that carries a reference."""
    lo = hi = header.column
    if carrier is not None:
        lo, hi = min(header.column, carrier.column), max(header.column, carrier.column)
    for cells in ws.iter_rows(min_row=header.row + 1, min_col=lo, max_col=hi):
        tokens = [t for t in re.split(r"\D+", str(cells[header.column - lo].value or ""))
                  if REF_MIN <= len(t) <= REF_MAX]
        if tokens:
            yield (cells[carrier.column - lo].value if carrier is not None else None), tokens


def main():
    ap = argparse.ArgumentParser(description="Build the out-of-tariff approval asset.")
    ap.add_argument("--xlsx", required=True, help="approval workbook to read")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "assets" / "aussertariflich.js"),
                    help="asset to write (default: the shipped asset in this repo)")
    ap.add_argument("--generated", default=datetime.date.today().isoformat(),
                    help="date stamped into the asset (YYYY-MM-DD)")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    path = Path(args.xlsx)
    if not path.exists():
        print(f"error: no such workbook: {path}", file=sys.stderr)
        return 2

    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    refs = set()
    dropped = {}  # carrier label -> [rows, refs on those rows]
    unknown = {}  # carrier label -> rows kept on an unrecognised name
    candidate_drops = set()
    for ws in wb.worksheets:
        header = find_header(ws, HEADERS)
        if header is None:
            print(f"{ws.title}: no Lieferschein/Deliverynote header, skipped")
            continue
        carrier = find_header(ws, CARRIER_HEADERS)
        kept = drops = 0
        for cell, tokens in sheet_rows(ws, header, carrier):
            kind = "none" if carrier is None else carrier_kind(cell)
            if kind == "other":
                entry = dropped.setdefault(str(cell).strip(), [0, set()])
                entry[0] += 1
                entry[1].update(tokens)
                candidate_drops.update(tokens)
                drops += 1
                continue
            kept += 1
            refs.update(tokens)
            if kind == "unknown":
                label = str(cell).strip()
                unknown[label] = unknown.get(label, 0) + 1
        skipped = "" if carrier is not None else ", no carrier column, kept whole"
        print(f"{ws.title}: {kept} rows kept, {drops} dropped{skipped}")
    dropped_refs = candidate_drops - refs
    refs = sorted(refs)
    print(f"distinct refs: {len(refs)}")
    print(f"10-digit: {sum(1 for r in refs if len(r) == 10)}")

    if dropped:
        print(f"\ncarrier filter: {sum(r for r, _ in dropped.values())} rows dropped, "
              f"{len(dropped_refs)} refs dropped")
        print(f"  {'carrier':<28}{'rows':>6}{'refs':>6}")
        labelled = 0
        for label, (rows, found) in sorted(dropped.items(), key=lambda kv: (-kv[1][0], kv[0])):
            labelled += len(found & dropped_refs)
            print(f"  {label:<28}{rows:>6}{len(found & dropped_refs):>6}")
        if labelled != len(dropped_refs):
            print(f"  {labelled - len(dropped_refs)} of those refs sit under more than one dropped carrier")
    if len(candidate_drops) != len(dropped_refs):
        print(f"  {len(candidate_drops) - len(dropped_refs)} dropped-row refs also sit on a kept row and stay")
    print("kept with no recognised carrier: "
          + (", ".join(f"{k} ({v} rows)" for k, v in sorted(unknown.items())) or "none"))

    if not refs:
        print(f"error: no Lieferschein/Deliverynote refs found in {path}; refusing to write "
              f"an empty approval list over {args.out}", file=sys.stderr)
        return 3

    obj = {"generated": args.generated, "source": path.name, "refs": refs}
    body = "window.AUSSERTARIFLICH=" + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    print(f"wrote {out} ({len(body.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
