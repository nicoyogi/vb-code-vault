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

/* No strings table: nothing to measure, so the fit floors at the 'Anmerkung'
   header itself: 9 chars + the 0.7109375 padding. Never the old 75.71. */
test('a column with nothing to measure gets the header fit, not the reference width', () => {
  const out = e.setAnmerkungColumnWidth('<dimension ref="A1:C4"/><sheetData><row r="3" spans="1:3"></row></sheetData>', 3);
  assert.match(out, /<cols><col min="4" max="4" width="9\.7109375" bestFit="1" customWidth="1"\/><\/cols><sheetData>/);
  assert.match(out, /<dimension ref="A1:D4"\/>/);
  assert.match(out, /<row r="3" spans="1:4">/);
});

/* The longest visible line of the column's own cells drives the width: both
   rows carry t="s", so the shared string is what gets measured. */
test('the width is the longest note in the column plus the cell padding', () => {
  const strings = ['FR=+12.40', 'Honold berechnet die Kosten nach dem bisherigen Tarif'];
  const xml = '<dimension ref="A1:D5"/><sheetData>' +
    '<row r="4"><c r="D4" s="7" t="s"><v>0</v></c></row>' +
    '<row r="5"><c r="D5" s="7" t="s"><v>1</v></c></row>' +
    '</sheetData>';
  const out = e.setAnmerkungColumnWidth(xml, 3, strings);
  assert.match(out, /<col min="4" max="4" width="53\.7109375" bestFit="1" customWidth="1"\/>/);
  assert.equal(e.setAnmerkungColumnWidth(out, 3, strings), out, 'idempotent: a second run changes nothing');
});

test('a shorter note does not shrink the column and a longer one still widens it', () => {
  const long = 'Honold berechnet die Kosten nach dem bisherigen Tarif';
  const short = ['x', long];
  const xml = '<sheetData><row r="4"><c r="D4" t="s"><v>0</v></c></row><row r="5"><c r="D5" t="s"><v>1</v></c></row></sheetData>';
  const out = e.setAnmerkungColumnWidth(xml, 3, short);
  assert.match(out, /width="53\.7109375"/, 'the longest cell wins regardless of row order');
  const longer = [...short, 'Honold berechnet die Kosten nach dem bisherigen Tarif und noch mehr'];
  const xml2 = xml + '<row r="6"><c r="D6" t="s"><v>2</v></c></row>';
  assert.match(e.setAnmerkungColumnWidth(xml2, 3, longer), /width="67\.7109375"/);
});

/* A wrapped note is one cell but several visible lines; the tagline says the
   column is sized to the longest line, not to the whole string. */
test('a multi-line note is measured on its longest line', () => {
  const strings = ['Anmerkung\nHonold berechnet die Kosten nach dem bisherigen Tarif'];
  const xml = '<sheetData><row r="4"><c r="D4" t="s"><v>0</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, strings), /width="53\.7109375"/);
});

/* A bare number in the column is text Excel shows as digits, so it measures as
   its digits (12.4 -> 4) and the header floor still wins. */
test('a numeric Anmerkung cell contributes its digits', () => {
  const xml = '<sheetData><row r="4"><c r="D4"><v>12.4</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, ['ignored']), /width="9\.7109375"/);
  const wide = '<sheetData><row r="4"><c r="D4"><v>12345678901.25</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(wide, 3, ['ignored']), /width="14\.7109375"/);
});

/* An inline string carries its text in <is><t> runs, not in the shared-strings
   table, so the width has to be read from those runs or the note is invisible. */
test('an inline string is measured from its <is><t> text', () => {
  const xml = '<sheetData><row r="4"><c r="D4" t="inlineStr"><is><t>Honold berechnet die Kosten nach dem bisherigen Tarif</t></is></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, ['x']), /width="53\.7109375"/);
});

/* Several runs make up one string, so they are joined before measuring, and the
   longest line of the joined text wins - a run boundary is not a line break. */
test('an inline string with several <t> runs is measured on the joined text', () => {
  const split = '<sheetData><row r="4"><c r="D4" t="inlineStr"><is><t>Honold berechnet die Kosten</t><t> nach dem bisherigen Tarif</t></is></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(split, 3, ['x']), /width="53\.7109375"/, 'the two runs join into one 53-char line');
  const wrapped = '<sheetData><row r="4"><c r="D4" t="inlineStr"><is><t>Anmerkung\n</t><t>' + 'y'.repeat(30) + '</t></is></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(wrapped, 3, ['x']), /width="30\.7109375"/, 'the longest line is 30, not the 40-char join');
});

/* An empty <v> is not index 0: Number('') is 0, which would measure the first
   shared string for a cell that stores nothing. */
test('a t="s" cell with an empty <v> is ignored', () => {
  const xml = '<sheetData><row r="4"><c r="D4" t="s"><v></v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, ['ZZZZZZZZZZZZZZZZ']), /width="9\.7109375"/);
});

/* A \r\n note is one line break, not a line break plus a visible character; the
   \r would otherwise widen the measured line by one. */
test('a \r\n note is measured without counting the carriage return', () => {
  const strings = ['x'.repeat(20) + '\r\ny'];
  const xml = '<sheetData><row r="4"><c r="D4" t="s"><v>0</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, strings), /width="20\.7109375"/);
});

/* Numbers and formula strings are listed as width sources, so a missing shared-
   strings table must not skip the measurement altogether. */
test('a numeric cell is still measured when no strings table is passed', () => {
  const xml = '<sheetData><row r="4"><c r="D4"><v>12345678901.25</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3), /width="14\.7109375"/);
});

/* A self-closed cell carries no text and must not be mistaken for a
   cell whose value lives between the tags. */
test('a self-closed cell contributes nothing and is not mis-parsed', () => {
  const xml = '<sheetData><row r="4"><c r="D4" s="7"/><c r="D5" t="s"><v>0</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, ['FR=+12.40']), /width="9\.7109375"/);
});

/* The attribute run must stay lazy: with a greedy run the match ran past the
   self-closed tag's '/>' to a later cell's </c> and measured that cell's text.
   Falsifies R1 for a styled-but-empty Anmerkung cell followed by any cell. */
test('a self-closed target cell does not measure a sibling column', () => {
  const xml = '<sheetData><row r="4"><c r="D4" s="7"/><c r="E4" t="s"><v>0</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, ['1234567890']), /width="9\.7109375"/, 'E4 carries the only text and must not widen D');
  const long = ['Honold berechnet die Kosten nach dem bisherigen Tarif'];
  assert.match(e.setAnmerkungColumnWidth(xml, 3, long), /width="9\.7109375"/, 'a long sibling-column note cannot widen D either');
});

/* Excel writers emit numeric character references, so an inline string that
   holds &#65; or &#x41; is measured as the one character it decodes to, not as
   the five literal characters of the reference. Falsifies R1 for inline text. */
test('an inline string decodes numeric character references before measuring', () => {
  const dec = '<sheetData><row r="4"><c r="D4" t="inlineStr"><is><t>&#65;&#66;&#67;&#68;&#69;&#70;&#71;&#72;&#73;&#74;</t></is></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(dec, 3, []), /width="10\.7109375"/, '10 decoded characters, not the 50 of the raw refs');
  const hex = '<sheetData><row r="4"><c r="D4" t="inlineStr"><is><t>&#x41;&#x42;&#x43;&#x44;&#x45;&#x46;&#x47;&#x48;&#x49;&#x4a;</t></is></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(hex, 3, []), /width="10\.7109375"/, 'hex references decode the same as decimal');
});

/* parseSharedStrings is deliberately left alone, so a shared string keeps its
   numeric references literal and the two paths are not symmetric by design. */
test('a shared string keeps numeric character references literal', () => {
  const xml = '<sheetData><row r="4"><c r="D4" t="s"><v>0</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, ['&#65;&#65;&#65;']), /width="15\.7109375"/, '15 raw characters, matching parseSharedStrings');
});

/* An inlineStr cell can also carry a <v> beside its <is>; the inline text is
   measured first and the <v> is then handled instead of being skipped.
   Falsifies R1 for a cell whose value sits in <v> rather than <is>. */
test('an inline string cell that also carries a <v> measures both', () => {
  const xml = '<sheetData><row r="4"><c r="D4" t="inlineStr"><is><t>ab</t></is><v>12345678901234567890</v></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(xml, 3, []), /width="20\.7109375"/, 'the longer <v> wins over the 2-char inline text');
  const plain = '<sheetData><row r="4"><c r="D4" t="inlineStr"><is><t>abcdefghij</t></is></c></row></sheetData>';
  assert.match(e.setAnmerkungColumnWidth(plain, 3, []), /width="10\.7109375"/, 'a plain inlineStr with no <v> is unchanged');
});

test('an existing exact column definition is replaced, never duplicated', () => {
  const xml = SHEET_XML.replace('<sheetData>', '<cols><col min="4" max="4" width="8.7109375" customWidth="1"/></cols><sheetData>');
  const out = e.setAnmerkungColumnWidth(xml, 3, ['Alt', 'X', 'Y', 'Anmerkung']);
  assert.equal((out.match(/<col\b/g) || []).length, 1);
  assert.match(out, /<col min="4" max="4" width="9\.7109375" bestFit="1" customWidth="1"\/>/);
});

/* Deliberate behaviour change vs 1.48.1: the width is a fit, so a source column
   wider than its content is narrowed. A column that keeps an old width is not
   sized to its content, and an over-wide column wastes the sheet. */
test('an existing column wider than the fit is narrowed to the fit', () => {
  const xml = '<dimension ref="A1:D4"/><cols><col min="4" max="4" width="75.7109375" bestFit="1" customWidth="1"/></cols><sheetData><row r="4"><c r="D4" t="s"><v>0</v></c></row></sheetData>';
  const out = e.setAnmerkungColumnWidth(xml, 3, ['FR=+12.40']);
  assert.match(out, /<col min="4" max="4" width="9\.7109375" bestFit="1" customWidth="1"\/>/);
  assert.equal((out.match(/<col\b/g) || []).length, 1, 'still exactly one definition');
});

test('widening an interior column never shrinks the dimension or spans', () => {
  const xml = '<dimension ref="A1:Z4"/><cols><col min="4" max="4" width="8" customWidth="1"/></cols><sheetData><row r="3" spans="1:12"></row></sheetData>';
  const out = e.setAnmerkungColumnWidth(xml, 3, ['FR=+12.40']); // D, not the last column
  assert.match(out, /<dimension ref="A1:Z4"\/>/);
  assert.match(out, /<row r="3" spans="1:12">/);
  assert.match(out, /<col min="4" max="4" width="9\.7109375" bestFit="1" customWidth="1"\/>/);
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
