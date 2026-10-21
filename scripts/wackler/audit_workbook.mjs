#!/usr/bin/env node
/*
 * Diff the Wackler Soll-Ist workbooks against the rule engine.
 *
 * `D:\TESTER\Wackler\*.xlsx` is the hand-corrected truth. `D:\TESTER\Before\Wackler\`
 * is the tool's own output kept for comparison: a fresh engine run replaces it, so this
 * tool accepts a `--dir` that points there for a replay but never reads it by default
 * and never writes either folder.
 *
 *   node scripts/wackler/audit_workbook.mjs
 *   node scripts/wackler/audit_workbook.mjs --dir 'D:\TESTER\Before\Wackler'
 *   node scripts/wackler/audit_workbook.mjs --file 'D:\TESTER\Wackler\10369563 Soll-Ist-Vergleich.xlsx' --rows 8
 *   node scripts/wackler/audit_workbook.mjs --json
 *
 * Every released row is scored twice: `raw` needs the exact trimmed string, `phrase`
 * compares the `//`-separated phrase list under the engine's own `normPhrase`, so a
 * hand-corrected cell that differs only in spacing or case shows up as an exact
 * difference without counting as a rule disagreement.
 *
 * Needs `py` (Python 3 with openpyxl): the sheet dump reuses scripts/dachser/dump_sheet.py,
 * which is forwarder-agnostic.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEngine } from '../../tests/harness/load-engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMP = join(HERE, '..', 'dachser', 'dump_sheet.py');
const DEFAULT_DIR = 'D:\\TESTER\\Wackler';
const SHEET = 'Soll-Ist-Vergleich best. Beleg';

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

function pickWorkbooks() {
  const file = flagValue('file');
  if (file) return [file];
  const dir = flagValue('dir') || DEFAULT_DIR;
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    die(`cannot read ${dir}: ${err.message}`);
  }
  const hits = names
    .filter((n) => n.endsWith('.xlsx') && !n.startsWith('~$'))
    .sort();
  if (!hits.length) die(`no .xlsx workbooks in ${dir}`);
  return hits.map((n) => join(dir, n));
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

function readSheet(path) {
  const py = process.env.PY || 'py';
  if (!existsSync(DUMP)) die(`missing sheet dump ${DUMP}`);
  let out;
  try {
    out = execFileSync(py, [DUMP, path, SHEET], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
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
  if (!text) die('--rows wants one or more row numbers, e.g. --rows 8,32');
  return text.replace(/,/g, ' ').split(/\s+/).filter(Boolean).map((p) => {
    if (!/^\d+$/.test(p)) die(`--rows wants row numbers, got ${JSON.stringify(p)}`);
    return Number(p);
  });
}

function phraseSet(e, s) {
  return e.splitTriggers(s || '').map(e.normPhrase).sort().join(' | ');
}

function main() {
  const json = flag('json');
  const e = loadEngine();
  const resolve = e.context.resolveWackler;
  if (typeof resolve !== 'function') die('engine has no resolveWackler');

  const wantRows = flag('rows') ? parseRows(flagValue('rows')) : [];
  const perBook = [];
  const total = { released: 0, rawDiff: 0, phraseDiff: 0, exact: 0 };

  for (const path of pickWorkbooks()) {
    const { data, ws } = readSheet(path);
    const range = decodeRange(data.ref);
    const cols = resolve(ws, range);
    if (cols.target < 0) die(`${data.sheet} has no Anmerkung column`);

    if (wantRows.length) {
      const rows = wantRows.map((excelRow) => {
        const r = excelRow - 1;
        if (r < 3 || r > range.e.r) die(`row ${excelRow} is outside the data rows 4..${range.e.r + 1}`);
        const engine = e.processWackler(ws, r, cols);
        const sheet = e.cellStr(ws, r, cols.target);
        if (!json) {
          console.log(`\n${path.split(/[\\/]/).pop()} row ${excelRow}`);
          console.log(`  sheet : ${sheet || '(blank)'}`);
          console.log(`  engine: ${engine === null ? '(not released: Stat_Freigabe != 10)' : (engine || '(blank)')}`);
        }
        return { row: excelRow, sheet, engine };
      });
      perBook.push({ workbook: path, sheet: data.sheet, rows });
      /* A selected row scores like a scanned one: any sheet/engine text difference fails the run. */
      if (rows.some((x) => (x.sheet || '').trim() !== (x.engine || '').trim())) process.exitCode = 1;
      continue;
    }

    const rawDiffs = [];
    const phraseDiffs = [];
    let released = 0, exact = 0;
    for (let r = 3; r <= range.e.r; r++) {
      const engine = e.processWackler(ws, r, cols);
      if (engine === null) continue;
      released++;
      const sheet = e.cellStr(ws, r, cols.target);
      if ((sheet || '').trim() === (engine || '').trim()) { exact++; continue; }
      rawDiffs.push({ row: r + 1, sheet, engine });
      if (phraseSet(e, sheet) !== phraseSet(e, engine)) {
        phraseDiffs.push({ row: r + 1, sheet, engine });
      }
    }
    perBook.push({ workbook: path, sheet: data.sheet, ref: data.ref, released, exact,
      raw: rawDiffs.length, phrase: phraseDiffs.length, rawDiffs, phraseDiffs });
    total.released += released;
    total.exact += exact;
    total.rawDiff += rawDiffs.length;
    total.phraseDiff += phraseDiffs.length;
  }

  if (total.rawDiff || total.phraseDiff) process.exitCode = 1;

  if (json) {
    console.log(JSON.stringify({ dir: flagValue('dir') || DEFAULT_DIR, total, workbooks: perBook }, null, 2));
    return;
  }

  if (wantRows.length) return;

  console.log('workbook'.padEnd(34) + 'released  exact   raw  phrase');
  for (const b of perBook) {
    console.log(`${b.workbook.split(/[\\/]/).pop().padEnd(34)}${String(b.released).padStart(8)}`
      + `${String(b.exact).padStart(7)}${String(b.raw).padStart(6)}${String(b.phrase).padStart(8)}`);
  }
  console.log(`${'TOTAL'.padEnd(34)}${String(total.released).padStart(8)}`
    + `${String(total.exact).padStart(7)}${String(total.rawDiff).padStart(6)}${String(total.phraseDiff).padStart(8)}`);

  for (const b of perBook) {
    if (!b.rawDiffs.length) continue;
    console.log(`\n${b.workbook.split(/[\\/]/).pop()}`);
    for (const d of b.rawDiffs) {
      const setDiff = b.phraseDiffs.some((p) => p.row === d.row);
      console.log(`  row ${d.row} ${setDiff ? '(phrase)' : '(format)'}`);
      console.log(`    sheet : ${d.sheet || '(blank)'}`);
      console.log(`    engine: ${d.engine || '(blank)'}`);
    }
  }
}

main();
