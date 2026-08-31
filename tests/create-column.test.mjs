/*
 * Anmerkung column auto-creation: when a sheet has no "Anmerkung" header,
 * the tool must append one after the last header of row 3 instead of
 * skipping the sheet — and patchSheet must write the new cells styled like
 * their neighbours (row-dominant style index).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeRow } from './harness/load-engine.mjs';

const e = loadEngine();

/* Minimal sheet: headers in row 3 (r=2) at cols 0..3, one data row. */
function makeSheet(headers) {
  const ws = makeRow(2, Object.fromEntries(headers.map((h, c) => [c, h])));
  Object.assign(ws, makeRow(3, { 0: 10 })); // Stat_Freigabe=10 → in scope
  return ws;
}
const RANGE = { s: { r: 0, c: 0 }, e: { r: 9, c: 9 } };

test('existing Anmerkung column is found, not re-created', () => {
  const got = e.ensureAnmerkungCol(makeSheet(['A', 'B', 'Anmerkung']), RANGE);
  assert.equal(got.idx, 2); // vm-realm objects: compare field-wise, not deepEqual
  assert.equal(got.ok, true);
});

test('missing Anmerkung column resolves to one past the last header', () => {
  const got = e.ensureAnmerkungCol(makeSheet(['A', 'B', 'C']), RANGE);
  assert.equal(got.idx, 3);
  assert.equal(got.ok, true);
});

test('sheet with no headers at all is not creatable', () => {
  const got = e.ensureAnmerkungCol(makeRow(0, { 0: 'x' }), RANGE);
  assert.equal(got.ok, false);
});

/* Sheet XML where every existing cell carries style s="7"; a newly created
   cell must inherit that dominant style so the column looks native. */
const SHEET_XML =
  '<sheetData>' +
  '<row r="3"><c r="A3" s="7" t="s"><v>0</v></c><c r="B3" s="7" t="s"><v>1</v></c><c r="C3" s="7" t="s"><v>2</v></c></row>' +
  '<row r="4"><c r="A4" s="7"><v>10</v></c></row>' +
  '</sheetData>';

test('patchSheet can copy the left header style for a created column', () => {
  const strings = ['Alt', 'X', 'Y'];
  const xml = SHEET_XML.replace('r="C3" s="7"', 'r="C3" s="3"');
  const out = e.patchSheet(xml, 'D', new Map([[3, 'Anmerkung']]), strings, -1);
  const m = /<c r="D3"[^>]*>/.exec(out);
  assert.ok(m, 'header cell D3 inserted');
  assert.match(m[0], /s="3"/, 'style copied from the header immediately to the left');
  assert.match(out, /t="s"/);
});

test('created Anmerkung values copy the reference body style five columns left', () => {
  const xml = '<sheetData><row r="4"><c r="A4" s="2"/><c r="B4" s="7"/><c r="C4" s="4"/><c r="D4" s="4"/><c r="E4" s="4"/></row></sheetData>';
  const out = e.patchSheet(xml, 'F', new Map([[4, 'Text']]), [], -5);
  assert.match(out, /<c r="F4" s="2" t="s">/);
});

test('patchSheet inserts value cells in column order with row style', () => {
  const strings = ['Alt', 'FR=+12.40'];
  let out = e.patchSheet(SHEET_XML, 'D', new Map([[4, 'FR=+12.40']]), strings);
  out = e.patchSheet(out, 'D', new Map([[3, 'Anmerkung']]), strings);
  const row4 = out.slice(out.indexOf('<row r="4"'), out.indexOf('</row>', out.indexOf('<row r="4"')));
  const dIdx = row4.indexOf('<c r="D4"');
  const aIdx = row4.indexOf('<c r="A4"');
  assert.ok(dIdx > aIdx, 'new cell placed after A4');
  assert.match(row4.slice(dIdx), /^<c r="D4" s="7"/, 'data style matches row');
});

test('created Anmerkung column gets the reference workbook width', () => {
  const out = e.setAnmerkungColumnWidth('<dimension ref="A1:C4"/><sheetData><row r="3" spans="1:3"></row></sheetData>', 3);
  assert.match(out, /<cols><col min="4" max="4" width="75\.7109375" bestFit="1" customWidth="1"\/><\/cols><sheetData>/);
  assert.match(out, /<dimension ref="A1:D4"\/>/);
  assert.match(out, /<row r="3" spans="1:4">/);
});

test('created Anmerkung column replaces an existing exact column definition', () => {
  const xml = SHEET_XML.replace('<sheetData>', '<cols><col min="4" max="4" width="12" customWidth="1"/></cols><sheetData>');
  const out = e.setAnmerkungColumnWidth(xml, 3);
  assert.equal((out.match(/<col\b/g) || []).length, 1);
  assert.match(out, /<col min="4" max="4" width="75\.7109375" bestFit="1" customWidth="1"\/>/);
});
