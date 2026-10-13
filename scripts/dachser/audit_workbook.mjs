#!/usr/bin/env node
/*
 * Diff a Dachser Soll-Ist workbook against the rule engine.
 *
 * The audit note (docs/anmerkung/dachser-sheet-audit-2026-10-09.md) was produced by a
 * scratch harness that dumped each sheet with openpyxl, rebuilt it as the worksheet the
 * engine expects, resolved the columns through `resolveDachser`, and ran `processDachser`
 * over every released row. This is that harness, kept, so the diff is reproducible and a
 * user-declared "workbook error" can be answered with the engine's own phrase.
 *
 *   node scripts/dachser/audit_workbook.mjs --date 20261006
 *   node scripts/dachser/audit_workbook.mjs --date 20261006 --rows 184
 *   node scripts/dachser/audit_workbook.mjs --date 20261006 --rows 184 --json
 *
 * `--rows` prints the engine phrase for one or more Excel row numbers, in the form
 * `fix_workbook.py --set` wants. No argument writes anything: this tool only reads.
 *
 * Needs `py` (Python 3 with openpyxl) for scripts/dachser/dump_sheet.py, and the local
 * plaintext assets/dachser-ratecards.js, without which the Sonderfahrt / bisherigen
 * branch is off and every FR row would be reported as a false difference.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEngine } from '../../tests/harness/load-engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMP = join(HERE, 'dump_sheet.py');
const DEFAULT_DIR = 'D:\\TESTER\\Dachser';

function die(msg) {
  console.error('error: ' + msg);
  process.exit(2);
}

function flagValue(name) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? '' : v;
}
function flag(name) { return process.argv.includes('--' + name); }

function pickWorkbook() {
  const file = flagValue('file');
  if (file) return file;
  const date = flagValue('date');
  if (!date) die('give --date YYYYMMDD or --file PATH');
  const dir = flagValue('dir') || DEFAULT_DIR;
  const hits = readdirSync(dir).filter(
    (n) => n.includes(date) && n.endsWith('.xlsx') && !n.startsWith('~$'));
  if (hits.length !== 1) {
    die(`--date ${date}: expected one workbook in ${dir}, found ${hits.length} ${JSON.stringify(hits)}`);
  }
  return join(dir, hits[0]);
}

/* XLSX A1 range, as XLSX.utils.decode_range would return it. */
function colIdx(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function decodeRange(ref) {
  const parts = String(ref).split(':');
  const one = (t) => {
    const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(t.trim());
    if (!m) die('cannot parse range ' + ref);
    return { r: Number(m[2]) - 1, c: colIdx(m[1]) };
  };
  const s = one(parts[0]);
  return { s, e: parts[1] ? one(parts[1]) : s };
}

function readSheet(path, sheet) {
  const py = process.env.PY || 'py';
  const args = [DUMP, path];
  if (sheet) args.push(sheet);
  let out;
  try {
    out = execFileSync(py, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  } catch (err) {
    die(`${py} ${DUMP} failed: ${err.stderr || err.message}`);
  }
  const data = JSON.parse(out);
  const ws = {};
  for (const [ref, v] of Object.entries(data.cells)) ws[ref] = { v };
  ws['!ref'] = data.ref;
  return { data, ws };
}

function parseRows(text) {
  if (!text) return [];
  return text.replace(/,/g, ' ').split(/\s+/).filter(Boolean).map((p) => {
    if (!/^\d+$/.test(p)) die(`--rows wants row numbers, got ${JSON.stringify(p)}`);
    return Number(p);
  });
}

function main() {
  const json = flag('json');
  const path = pickWorkbook();
  const { data, ws } = readSheet(path, flagValue('sheet'));
  const e = loadEngine();

  if (!e.DACHSER_RATECARDS) {
    console.error('warning: assets/dachser-ratecards.js is missing, so the Sonderfahrt / '
      + 'bisherigen branch is off and every FR row reads as "bisherigen".');
  }

  const range = decodeRange(data.ref);
  const cols = e.resolveDachser(ws, range);
  if (cols.target < 0) die(`${data.sheet} has no Anmerkung column`);

  const rows = parseRows(flagValue('rows'));
  if (rows.length) {
    const out = [];
    for (const excelRow of rows) {
      const r = excelRow - 1;
      if (r < 3 || r > range.e.r) die(`row ${excelRow} is outside the data rows 4..${range.e.r + 1}`);
      const engine = e.processDachser(ws, r, cols);
      const sheet = e.cellStr(ws, r, cols.target);
      out.push({ row: excelRow, sheet, engine });
      if (!json) {
        console.log(`row ${excelRow}`);
        console.log(`  sheet : ${sheet || '(blank)'}`);
        console.log(`  engine: ${engine === null ? '(not released: Stat_Freigabe != 10)' : (engine || '(blank)')}`);
        if (typeof engine === 'string' && engine) console.log(`  --set "${engine}"`);
      }
    }
    if (json) console.log(JSON.stringify({ workbook: path, sheet: data.sheet, rows: out }, null, 2));
    return;
  }

  const diffs = [];
  const engineOnly = [];
  let noted = 0, exact = 0, released = 0, skipped = 0, blank = 0;
  for (let r = 3; r <= range.e.r; r++) {
    const engine = e.processDachser(ws, r, cols);
    if (engine === null) { skipped++; continue; }
    released++;
    const sheet = e.cellStr(ws, r, cols.target);
    if (sheet) noted++;
    if (!sheet && !engine) { blank++; continue; }
    if (sheet === engine) { exact++; continue; }
    if (sheet) diffs.push({ row: r + 1, sheet, engine });
    else engineOnly.push({ row: r + 1, engine });
  }

  if (json) {
    console.log(JSON.stringify({
      workbook: path, sheet: data.sheet, ref: data.ref,
      noted, exact, differ: diffs.length, engineOnly: engineOnly.length,
      released, skipped, blank, diffs, extra: engineOnly,
    }, null, 2));
    return;
  }

  console.log(`workbook        : ${path}`);
  console.log(`sheet           : ${data.sheet} (${data.ref})`);
  console.log(`rows with a note: ${noted}`);
  console.log(`  exact         : ${exact}`);
  console.log(`  differ        : ${diffs.length}`);
  console.log(`engine-only note: ${engineOnly.length} (a phrase the sheet does not carry)`);
  console.log(`released rows   : ${released} (${skipped} skipped, Stat_Freigabe != 10)`);

  for (const d of diffs) {
    console.log(`\nrow ${d.row}\n  sheet : ${d.sheet}\n  engine: ${d.engine || '(blank)'}`);
  }
  if (engineOnly.length) {
    console.log('\nrows the engine wants a note on but the sheet carries none:');
    for (const x of engineOnly) console.log(`  row ${x.row}: ${x.engine}`);
  }
}

main();
