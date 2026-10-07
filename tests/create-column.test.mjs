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

/* The width must also fire on a sheet that already carries an Anmerkung column
   (the Honold 20379045 workbook has one at BK with width 8.71), not just on the
   auto-created one, or narrow source columns stay unreadable. */
test('an existing narrow Anmerkung column is widened to the reference', () => {
  const xml = '<dimension ref="A1:D4"/><cols><col min="4" max="4" width="8.7109375" bestFit="1" customWidth="1"/></cols><sheetData><row r="3" spans="1:4"></row></sheetData>';
  const out = e.setAnmerkungColumnWidth(xml, 3);
  assert.match(out, /<col min="4" max="4" width="75\.7109375" bestFit="1" customWidth="1"\/>/);
  assert.equal((out.match(/<col\b/g) || []).length, 1, 'still exactly one definition');
  assert.match(out, /<dimension ref="A1:D4"\/>/, 'an existing end column is not rewritten');
  assert.match(out, /<row r="3" spans="1:4">/, 'spans already at the column are not rewritten');
});

test('an existing wider Anmerkung column keeps its width', () => {
  const xml = '<dimension ref="A1:D4"/><cols><col min="4" max="4" width="129.5703125" bestFit="1" customWidth="1"/></cols><sheetData></sheetData>';
  assert.equal(e.setAnmerkungColumnWidth(xml, 3), xml);
});

test('widening an interior column never shrinks the dimension or spans', () => {
  const xml = '<dimension ref="A1:Z4"/><cols><col min="4" max="4" width="8" customWidth="1"/></cols><sheetData><row r="3" spans="1:12"></row></sheetData>';
  const out = e.setAnmerkungColumnWidth(xml, 3); // D, not the last column
  assert.match(out, /<dimension ref="A1:Z4"\/>/);
  assert.match(out, /<row r="3" spans="1:12">/);
  assert.match(out, /<col min="4" max="4" width="75\.7109375" bestFit="1" customWidth="1"\/>/);
});

/* The source Soll-Ist sheets carry their AutoFilter on the row-3 header row
   (e.g. <autoFilter ref="A3:BC55"/>). A created Anmerkung column sits past the
   old last header, so the filter must grow to include it or it has no dropdown;
   a sheet with no filter at all gets one built over its row-3 headers. */
test('ensureAutoFilter grows the row-3 filter to cover the created column', () => {
  const xml = '<autoFilter ref="A3:BC55" xr:uid="{x}"/>';
  const out = e.ensureAutoFilter(xml, 55); // BD
  assert.match(out, /<autoFilter ref="A3:BD55"/);
  assert.match(out, /xr:uid="\{x\}"/);
});

test('ensureAutoFilter keeps the filter end row and never shrinks it', () => {
  const xml = '<autoFilter ref="A3:BC55"/>';
  assert.equal(e.ensureAutoFilter(xml, 10), xml, 'a column left of the end is untouched');
  assert.equal(e.ensureAutoFilter(xml, 54), xml, 'the current end column is untouched');
});

test('ensureAutoFilter creates a row-3 filter when the sheet has none', () => {
  const xml = '<worksheet><dimension ref="A1:B4"/><sheetData>' +
    '<row r="3"><c r="A3" s="5" t="s"><v>0</v></c><c r="B3" s="5" t="s"><v>1</v></c></row>' +
    '<row r="4"><c r="A4"><v>10</v></c></row>' +
    '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>';
  const out = e.ensureAutoFilter(xml, 2); // C
  assert.match(out, /<autoFilter ref="A3:C4"\/>/);
  assert.ok(out.indexOf('<autoFilter') < out.indexOf('<mergeCells'), 'autoFilter precedes mergeCells');
  assert.ok(out.indexOf('<autoFilter') > out.indexOf('</sheetData>'), 'autoFilter follows sheetData');
});

test('ensureAutoFilter takes the first row-3 header and last row when there is no dimension', () => {
  const xml = '<worksheet><sheetData>' +
    '<row r="3"><c r="B3" t="s"><v>0</v></c><c r="C3" t="s"><v>1</v></c></row>' +
    '<row r="6"><c r="B6"><v>1</v></c></row>' +
    '</sheetData></worksheet>';
  assert.match(e.ensureAutoFilter(xml, 3), /<autoFilter ref="B3:D6"\/>/); // D
});

test('ensureAutoFilter preserves an existing autoFilter that carries child filterColumns', () => {
  const xml = '<autoFilter ref="A3:B5"><filterColumn colId="1"><filters><filter val="x"/></filters></filterColumn></autoFilter>';
  const out = e.ensureAutoFilter(xml, 3); // D
  assert.match(out, /<autoFilter ref="A3:D5">/);
  assert.match(out, /<filter val="x"\/>/);
});

test('ensureAutoFilter covers the reason column one past the Anmerkung column', () => {
  const xml = '<autoFilter ref="A3:D9"/>'; // ends at D (idx 3)
  assert.match(e.ensureAutoFilter(xml, 3), /ref="A3:D9"/, 'Anmerkung column alone needs no growth');
  assert.match(e.ensureAutoFilter(xml, 4), /ref="A3:E9"/, 'reason column is included');
});

test('ensureAutoFilter never adds a second filter and handles absolute refs', () => {
  const cell = '<worksheet><sheetData></sheetData><autoFilter ref="A3"><filterColumn colId="0"/></autoFilter></worksheet>';
  assert.equal(e.ensureAutoFilter(cell, 5), cell, 'an autoFilter shape we do not grow is left as the only one');
  assert.equal(e.ensureAutoFilter('<worksheet><autoFilter/></worksheet>', 5), '<worksheet><autoFilter/></worksheet>', 'a refless autoFilter is left alone');
  assert.match(e.ensureAutoFilter('<autoFilter ref="$A$3:$BC$55"/>', 55), /ref="A3:BD55"/);
  assert.match(e.ensureAutoFilter("<autoFilter ref='A3:B5'/>", 3), /ref="A3:D5"/);
  assert.match(e.ensureAutoFilter('<autoFilter ref = "A3:B5"/>', 3), /ref="A3:D5"/);
});

test('ensureAutoFilter clamps a too-short dimension and skips headerless sheets', () => {
  const xml = '<worksheet><dimension ref="A1:B2"/><sheetData>' +
    '<row r="3"><c r="A3"/></row></sheetData></worksheet>';
  assert.match(e.ensureAutoFilter(xml, 1), /<autoFilter ref="A3:B3"\/>/);
  const bare = '<worksheet><sheetData><row r="1"><c r="A1"/></row></sheetData></worksheet>';
  assert.equal(e.ensureAutoFilter(bare, 3), bare, 'no row-3 header means no filter');
});
