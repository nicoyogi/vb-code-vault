/*
 * Differenz-column cell styling: addDiffStyleXf / firstStyleIdx /
 * addDiffStyleXf / columnStyleIdxs / recolourColumn / diffColsOf operate on raw
 * xl/styles.xml + sheet XML.
 *
 * The fixture mirrors the operator sample's styles.xml shape (fonts 3,
 * fills 6, borders 2, cellStyleXfs 2, cellXfs 9 with the Differenz donor
 * xf at index 4, cellStyles 2, no numFmts) so the index arithmetic is the
 * real one, not a toy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness/load-engine.mjs';

const e = loadEngine();

const DONOR_XF = '<xf numFmtId="4" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>';
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><i/><sz val="9"/><name val="Arial"/></font></fonts>' +
  '<fills count="6">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D8"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/></cellStyleXfs>' +
  '<cellXfs count="9">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
  DONOR_XF +
  '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>' +
  '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="2"><cellStyle name="Standard" xfId="0" builtinId="0"/><cellStyle name="Schlecht" xfId="1" builtinId="27"/></cellStyles>' +
  '<dxfs count="0"/>' +
  '</styleSheet>';

/* vm-realm objects: compare field-wise, never deepEqual across realms. */
function xfEntries(xml) {
  const block = /<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/.exec(xml)[0];
  return [...block.matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m => m[0]);
}
function fillsCount(xml) { return Number(/<fills count="(\d+)"/.exec(xml)[1]); }
function xfsCount(xml) { return Number(/<cellXfs count="(\d+)"/.exec(xml)[1]); }

test('addDiffStyleXf appends one fill and one xf and bumps both counts', () => {
  const r = e.addDiffStyleXf(STYLES_XML, 'bad', 4);
  assert.equal(r.styleIdx, 9); // old count 9 -> new index 9
  assert.equal(fillsCount(r.xml), 7);
  assert.equal(xfsCount(r.xml), 10);
  assert.equal(xfEntries(r.xml).length, 10);
  assert.equal((r.xml.match(/FFC7CE/g) || []).length, 1, 'exactly one new Bad fill');
});

test('each preset writes its own fill and gets its own index', () => {
  let xml = STYLES_XML;
  const idx = [];
  for (const preset of ['bad', 'good', 'neutral']) {
    const r = e.addDiffStyleXf(xml, preset, 4);
    idx.push(r.styleIdx);
    xml = r.xml;
  }
  assert.deepEqual(idx, [9, 10, 11]);
  for (const hex of ['FFC7CE', 'C6EFCE', 'FFEB9C']) assert.ok(xml.includes(hex), hex + ' present');
  const entries = xfEntries(xml);
  assert.match(entries[9], /fillId="6"/); // fills 6..8 are the appended ones
  assert.match(entries[10], /fillId="7"/);
  assert.match(entries[11], /fillId="8"/);
});

test('normal writes nothing — xml returned unchanged, styleIdx -1', () => {
  const r = e.addDiffStyleXf(STYLES_XML, 'normal', 4);
  assert.equal(r.styleIdx, -1);
  assert.strictEqual(r.xml, STYLES_XML);
});

test('the cloned xf keeps the number format and gains exactly one fillId', () => {
  const r = e.addDiffStyleXf(STYLES_XML, 'bad', 4);
  const clone = xfEntries(r.xml)[r.styleIdx];
  assert.match(clone, /numFmtId="4"/);
  assert.match(clone, /applyNumberFormat="1"/);
  assert.match(clone, /borderId="1"/);
  assert.match(clone, /applyFont="1"/);
  assert.match(clone, /fillId="6"/);
  assert.match(clone, /applyFill="1"/);
  assert.equal((clone.match(/fillId=/g) || []).length, 1, 'a duplicate fillId attribute would make Excel demand a repair');
  assert.equal((clone.match(/applyFill=/g) || []).length, 1);
  assert.ok(clone.endsWith('/>'), 'self-closing donor stays self-closing');
});

test('the appended fill is the exact markup Excel renders', () => {
  /* pinned verbatim: fgColor + patternType solid — swapping in bgColor or solid→none renders no fill and previously passed every test */
  const r = e.addDiffStyleXf(STYLES_XML, 'good', 4);
  assert.match(r.xml, /<patternFill patternType="solid"><fgColor rgb="FFC6EFCE"\/>/);
});

test('counts fall back to child counts when the count attribute is missing/malformed', () => {
  const broken = STYLES_XML
    .replace('<fills count="6">', '<fills count="abc">')
    .replace('<cellXfs count="9">', '<cellXfs>');
  const r = e.addDiffStyleXf(broken, 'bad', 4);
  assert.equal(r.styleIdx, 9); // 9 xf children counted, not parsed from a broken attribute
  assert.match(r.xml, /<fills count="7">/);
  assert.match(r.xml, /<cellXfs count="10">/);
});

test('missing <fills> degrades to -1 with the input unchanged', () => {
  const noFills = STYLES_XML.replace(/<fills\b[^>]*>[\s\S]*?<\/fills>/, '');
  const r = e.addDiffStyleXf(noFills, 'bad', 4);
  assert.equal(r.styleIdx, -1);
  assert.strictEqual(r.xml, noFills);
});

test('missing <cellXfs> degrades to -1 and appends no xf', () => {
  const noXfs = STYLES_XML.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, '');
  const r = e.addDiffStyleXf(noXfs, 'good', 4); // good actually appends a fill — with bad the fill already exists, which is why the orphan-fill leak stayed invisible
  assert.equal(r.styleIdx, -1);
  assert.strictEqual(r.xml, noXfs, 'skipped style must not leak the <fill> appended before the cellXfs check');
  assert.ok(!/<xf\b[^>]*fillId="6"/.test(r.xml), 'no xf was appended');
});

test('out-of-range donor index degrades to -1', () => {
  assert.equal(e.addDiffStyleXf(STYLES_XML, 'bad', 99).styleIdx, -1);
  assert.equal(e.addDiffStyleXf(STYLES_XML, 'bad', -1).styleIdx, -1);
  const r = e.addDiffStyleXf(STYLES_XML, 'good', 999);
  assert.equal(r.styleIdx, -1);
  assert.strictEqual(r.xml, STYLES_XML, 'skipped style must not leak the <fill> appended before the donor check');
});

test('a repeated call with the same donor reuses the same index (no second xf)', () => {
  const first = e.addDiffStyleXf(STYLES_XML, 'bad', 4);
  const again = e.addDiffStyleXf(first.xml, 'bad', 4);
  assert.equal(again.styleIdx, first.styleIdx);
  assert.equal(fillsCount(again.xml), 7);
  assert.equal(xfsCount(again.xml), 10);
  const other = e.addDiffStyleXf(first.xml, 'good', 4);
  const back = e.addDiffStyleXf(other.xml, 'bad', 4);
  assert.equal(back.styleIdx, first.styleIdx);
  assert.equal(xfsCount(other.xml), 11);
  assert.equal(xfsCount(back.xml), 11);
});

const SHEET_XML =
  '<sheetData>' +
  '<row r="3"><c r="A3" s="2" t="s"><v>2</v></c><c r="BD3" s="3" t="s"><v>1</v></c></row>' +
  '<row r="4"><c r="A4" s="2"><v>10</v></c><c r="BD4" s="4"><v>110</v></c></row>' +
  '<row r="5"><c r="BD5"><v>210</v></c></row>' +
  '</sheetData>';

test('recolourColumn sends text cells to the text twin and numeric cells to the numeric twin', () => {
  const t = e.recolourColumn(SHEET_XML, 'BD', 9, 10);
  assert.equal(t.cells, 2); // BD3 (text) + BD4 (numeric); BD5 carries no s= so it is left alone
  assert.match(t.xml, /<c r="BD3" s="9" t="s"/, 'header text cell takes the text twin');
  assert.match(t.xml, /<c r="BD4" s="10">/, 'numeric data cell takes the numeric twin');
  assert.doesNotMatch(t.xml, /<c r="BD4" s="4"/);
  assert.match(t.xml, /<c r="A4" s="2"/, 'other column untouched');
});

/* The operator's reference keeps "@" on the group column's TEXT cells — the empty shared
   strings and the header words — while every numeric cell takes #,##0.00. Splitting on the
   cell's own t= attribute is what reproduces that; a row-based split does not, because AO's
   blank rows are shared strings while AR's blank rows are numeric. */
test('recolourColumn keys off t="s", not off the row number', () => {
  const xml = '<sheetData>' +
    '<row r="1"><c r="AO1" s="3" t="s"><v>0</v></c></row>' +
    '<row r="7"><c r="AO7" s="1" t="s"><v>0</v></c></row>' +
    '<row r="8"><c r="AO8" s="2"><v>0</v></c></row>' +
    '</sheetData>';
  const t = e.recolourColumn(xml, 'AO', 6, 7);
  assert.equal(t.cells, 3);
  assert.match(t.xml, /<c r="AO7" s="6" t="s">/, 'a blank DATA row that is a shared string keeps the text twin');
  assert.match(t.xml, /<c r="AO8" s="7">/, 'a numeric data row takes the numeric twin');
});

test('recolourColumn on a column with no matching cells changes nothing', () => {
  const t = e.recolourColumn(SHEET_XML, 'ZZ', 9, 10);
  assert.equal(t.cells, 0);
  assert.strictEqual(t.xml, SHEET_XML);
  const guarded = e.recolourColumn(SHEET_XML, 'BD', -1, -1);
  assert.equal(guarded.cells, 0);
  assert.strictEqual(guarded.xml, SHEET_XML);
});

/* Donor split: in the fixture BD3 carries the header xf (s="3", numFmtId 49 = "@" text) and
   BD4 the data xf (s="4", numFmtId 4 = #,##0.00). The header's must land in the text bucket
   and the data cell's in the numeric one, or the number format is silently stripped. */
test('columnStyleIdxs splits a column into its text and numeric source styles', () => {
  // vm-realm arrays are not reference-equal across realms: compare field-wise (joined text).
  const z = e.columnStyleIdxs(SHEET_XML, 'BD');
  assert.equal(z.text.join(','), '3');
  assert.equal(z.num.join(','), '4');
  const empty = e.columnStyleIdxs('<sheetData><row r="9"><c r="BD9" s="5"/></row></sheetData>', 'ZZ');
  assert.equal(empty.text.join(','), '');
  assert.equal(empty.num.join(','), '');
});

test('columnStyleIdxs keeps the distinct styles inside each bucket', () => {
  const xml = '<sheetData>' +
    '<row r="4"><c r="AO4" s="7"><v>1</v></c></row>' +
    '<row r="5"><c r="AO5" s="2"><v>2</v></c></row>' +
    '<row r="6"><c r="AO6" s="6" t="s"><v>3</v></c></row>' +
    '</sheetData>';
  const z = e.columnStyleIdxs(xml, 'AO');
  assert.equal(z.num.join(','), '7,2');
  assert.equal(z.text.join(','), '6');
});

test('pickDonor prefers the numeric xf so the clone carries #,##0.00', () => {
  // s=1 is the "@" xf, s=2 the #,##0.00 one; first-seen order would pick the wrong one.
  assert.equal(e.pickDonor(STYLES_XML, [1, 2]), 2);
  assert.equal(e.pickDonor(STYLES_XML, [9, 2]), 2);
  assert.equal(e.pickDonor(STYLES_XML, [4]), 4);
  assert.equal(e.pickDonor(STYLES_XML, []), -1);
});

test('the hunted donor carries the number format into the appended clone', () => {
  const z = e.columnStyleIdxs(SHEET_XML, 'BD');
  const r = e.addDiffStyleXf(STYLES_XML, 'good', e.pickDonor(STYLES_XML, z.num), 'Aptos Narrow');
  const clone = xfEntries(r.xml)[r.styleIdx];
  assert.match(clone, /numFmtId="4"/);
  assert.match(clone, /applyNumberFormat="1"/);
  assert.doesNotMatch(clone, /numFmtId="49"/);
});

const RANGE = { s: { r: 0, c: 0 }, e: { r: 9, c: 59 } };

function makeWs() {
  const ws = {};
  ws[e.encode_cell({ r: 1, c: 41 })] = { v: 'AVIS' };      // Excel AO2 — group
  ws[e.encode_cell({ r: 2, c: 41 })] = { v: 'Differenz' }; // Excel AO3
  ws[e.encode_cell({ r: 1, c: 44 })] = { v: 'FR' };        // Excel AR2 — group
  ws[e.encode_cell({ r: 2, c: 44 })] = { v: 'Differenz' }; // Excel AR3
  ws[e.encode_cell({ r: 1, c: 55 })] = { v: 'Total' };     // Excel BD2
  ws[e.encode_cell({ r: 2, c: 55 })] = { v: 'Differenz' }; // Excel BD3
  return ws;
}

test('diffColsOf returns the GROUP Differenz columns and leaves Total/Differenz alone', () => {
  const ws = makeWs();
  assert.equal(e.findCol(ws, RANGE, '', 'Differenz'), 41, 'the bare lookup really does return the AVIS column');
  assert.equal(e.diffColsOf(ws, RANGE).join(','), '41,44', 'AO + AR, never BD (Total)');
  assert.ok(e.diffColsOf(ws, RANGE).indexOf(55) < 0, 'Total/Differenz must never be recoloured');
});

test('diffColsOf returns an empty list without throwing when there is no group column', () => {
  const ws = {};
  ws[e.encode_cell({ r: 1, c: 0 })] = { v: 'X' };
  ws[e.encode_cell({ r: 2, c: 0 })] = { v: 'Y' };
  assert.equal(e.diffColsOf(ws, RANGE).join(','), '');
  assert.equal(e.diffColsOf(null, RANGE).join(','), '');
});

test('diffColsOf ignores a Total group spelled with different case or padding', () => {
  const ws = {};
  ws[e.encode_cell({ r: 1, c: 10 })] = { v: ' TOTAL ' };
  ws[e.encode_cell({ r: 2, c: 10 })] = { v: 'Differenz' };
  ws[e.encode_cell({ r: 1, c: 12 })] = { v: 'SNK' };
  ws[e.encode_cell({ r: 2, c: 12 })] = { v: 'Differenz' };
  assert.equal(e.diffColsOf(ws, RANGE).join(','), '12');
});
