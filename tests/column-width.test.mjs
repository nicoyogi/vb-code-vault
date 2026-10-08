/*
 * Independent falsification tests for the Anmerkung column-width fit.
 *
 * Scope: assets/anmerkung.js setAnmerkungColumnWidth / fittedColWidth / colWidthFromText
 * (working-tree change: the width is computed from the column's own content instead of
 * the hardcoded 75.7109375).
 *
 * Every expected number below is derived from the source, not copied from
 * tests/create-column.test.mjs:
 *   COL_PAD = 0.7109375        (assets/anmerkung.js:2093)
 *   COL_MIN = 9.7109375        (9-char "Anmerkung" header + COL_PAD)
 *   COL_MAX = 255
 *   colWidthFromText(t) = t ? COL_PAD + max([...line].length over t.split("\n")) : 0
 *   fittedColWidth starts at the header width and takes the max over cells whose
 *   ref is exactly column D (regex lookahead r="D(\d+)"), then clamps to [COL_MIN, COL_MAX].
 *
 * These tests intentionally try to break the feature. A failing assertion here is a
 * finding, not something to "fix" by editing the engine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './harness/load-engine.mjs';

const e = loadEngine();

/* The real shared-strings parser, lifted from the engine source and executed, so
   the shared-string fixtures below are fed exactly what the runtime feeds them.
   The harness does not export parseSharedStrings, so this is the only way to tie
   the width fixtures to the parser that actually builds the strings table. */
const PARSE_SS_SRC = readFileSync(
  fileURLToPath(new URL('../assets/anmerkung.js', import.meta.url)), 'utf8')
  .split('\n').find((l) => l.startsWith('function parseSharedStrings('));
if (!PARSE_SS_SRC || !PARSE_SS_SRC.endsWith('}')) {
  throw new Error('parseSharedStrings not found in assets/anmerkung.js');
}
const parseSharedStrings = new Function(PARSE_SS_SRC + '\nreturn parseSharedStrings;')();

const PAD = 0.7109375;
const MIN = 9.7109375; // "Anmerkung".length (9) + PAD
const MAX = 255;

/* The single `<col min="4" max="4" .../>` definition, if any. */
const colTag = (xml) => (/<col\b[^>]*\bmin="4"[^>]*\bmax="4"[^>]*\/>/.exec(xml) || [])[0];
const widthOf = (xml) => Number(/width="([^"]+)"/.exec(colTag(xml))[1]);
const cell = (ref, body, attrs = '') => `<c r="${ref}"${attrs}>${body}</c>`;

/* A cell whose shared-string value must be measured. */
const sharedCell = (ref, idx) => cell(ref, `<v>${idx}</v>`, ' t="s"');
/* A self-closing cell: no value, must contribute nothing measurable. */
const emptyCell = (ref) => `<c r="${ref}" s="7"/>`;

const LONG = 'Honold berechnet die Kosten nach dem bisherigen Tarif'; // 53 chars

test('shared string: width is exactly COL_PAD + longest line', () => {
  const xml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  const out = e.setAnmerkungColumnWidth(xml, 3, [LONG]);
  assert.equal(LONG.length, 53, 'fixture sanity: the note is 53 chars');
  assert.equal(widthOf(out), 53 + PAD);
});

test('shared string: the longest of several cells wins, in any row order', () => {
  const short = 'FR=+12.40'; // 9 chars -> below the header floor
  const xml = '<sheetData>' +
    `<row r="5">${sharedCell('D5', 0)}</row>` +
    `<row r="4">${sharedCell('D4', 1)}</row>` +
    '</sheetData>';
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [short, LONG])), 53 + PAD);
});

test('R1: an inline string (t="inlineStr") is measured', () => {
  /* R1 lists inline strings among the sources of the longest visible line. The
     engine writes shared strings itself, but a source workbook may carry inline
     strings, so a column of inline notes must not fall back to the floor. */
  const xml = `<sheetData><row r="4">${cell('D4', `<is><t>${LONG}</t></is>`, ' t="inlineStr"')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), 53 + PAD);
});

test('R1: a formula string (t="str") with a cached <v> is measured', () => {
  const xml = `<sheetData><row r="4">${cell('D4', `<f>A1</f><v>${LONG}</v>`, ' t="str"')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), 53 + PAD);
});

test('plain number: width is COL_PAD + the digits Excel stored', () => {
  const num = '12345678901.25'; // 14 chars
  const xml = `<sheetData><row r="4">${cell('D4', `<v>${num}</v>`)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['ignored'])), 14 + PAD);
});

test('plain number shorter than the header keeps the floor', () => {
  const xml = `<sheetData><row r="4">${cell('D4', '<v>12.4</v>')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['ignored'])), MIN);
});

test('multi-line shared string: the longest LINE drives the width, not the whole string', () => {
  const note = 'Anmerkung\n' + 'y'.repeat(30); // 9 + 1 + 30 = 40 chars, longest line 30
  const xml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  const got = widthOf(e.setAnmerkungColumnWidth(xml, 3, [note]));
  assert.equal(got, 30 + PAD, 'longest line is 30, not the 40-char string');
  assert.notEqual(got, 40 + PAD);
});

test('multi-line shared string whose longest line is below the header keeps the floor', () => {
  const xml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['ab\ncd'])), MIN);
});

test('floor: a column with nothing measurable gets 9.7109375', () => {
  const xml = '<dimension ref="A1:C4"/><sheetData><row r="3" spans="1:3"></row></sheetData>';
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3)), MIN);
});

test('floor: an empty strings table and a missing strings argument both floor', () => {
  const xml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [])), MIN);
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3)), MIN);
});

test('no <cols> at all: <cols> is created immediately before <sheetData>', () => {
  const xml = '<worksheet><dimension ref="A1:C4"/><sheetData>' +
    `<row r="4">${sharedCell('D4', 0)}</row></sheetData></worksheet>`;
  const out = e.setAnmerkungColumnWidth(xml, 3, [LONG]);
  assert.ok(out.indexOf('<cols>') > out.indexOf('<dimension'), 'cols after dimension');
  assert.ok(out.indexOf('</cols>') < out.indexOf('<sheetData'), 'cols before sheetData');
  assert.equal(out,
    '<worksheet><dimension ref="A1:D4"/><cols>' +
    `<col min="4" max="4" width="${53 + PAD}" bestFit="1" customWidth="1"/>` +
    `</cols><sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData></worksheet>`);
});

test('replace: an existing exact <col> is replaced, never duplicated', () => {
  const xml = '<worksheet><cols>' +
    '<col min="1" max="3" width="12.5" customWidth="1"/>' +
    '<col min="4" max="4" width="8.7109375" customWidth="1"/>' +
    '<col min="5" max="5" width="20"/>' +
    `</cols><sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData></worksheet>`;
  const out = e.setAnmerkungColumnWidth(xml, 3, [LONG]);
  assert.equal((out.match(/<col\b/g) || []).length, 3, 'still three <col> definitions');
  assert.equal((out.match(/<col\b[^>]*\bmin="4"[^>]*\bmax="4"/g) || []).length, 1, 'exactly one for column D');
  assert.equal(widthOf(out), 53 + PAD);
  assert.ok(out.includes('<col min="1" max="3" width="12.5" customWidth="1"/>'), 'sibling 1-3 byte-identical');
  assert.ok(out.includes('<col min="5" max="5" width="20"/>'), 'sibling 5-5 byte-identical');
});

test('replace: an existing WIDER <col> is narrowed to the fit (documented behaviour change)', () => {
  const xml = '<worksheet><cols><col min="4" max="4" width="75.7109375" bestFit="1" customWidth="1"/></cols>' +
    `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData></worksheet>`;
  const out = e.setAnmerkungColumnWidth(xml, 3, [LONG]);
  assert.equal((out.match(/<col\b/g) || []).length, 1);
  assert.equal(widthOf(out), 53 + PAD);
});

test('idempotence: feeding the output back in returns the identical string', () => {
  const xml = '<worksheet><dimension ref="A1:B6"/><cols><col min="1" max="1" width="5"/></cols>' +
    `<sheetData><row r="3" spans="1:4"><c r="A3"/></row>` +
    `<row r="4" spans="1:2">${sharedCell('D4', 0)}</row>` +
    `<row r="6" spans="1:9"><c r="A6"/></row></sheetData></worksheet>`;
  const once = e.setAnmerkungColumnWidth(xml, 3, [LONG]);
  const twice = e.setAnmerkungColumnWidth(once, 3, [LONG]);
  assert.equal(twice, once);
  assert.equal(e.setAnmerkungColumnWidth(twice, 3, [LONG]), once, 'stable after a third run');
});

test('other columns: DA and DD cells are never measured', () => {
  const xml = '<sheetData>' +
    `<row r="4">${sharedCell('DA4', 0)}${sharedCell('DD4', 0)}</row>` +
    `<row r="11">${sharedCell('DA11', 0)}${sharedCell('DD11', 0)}</row>` +
    '</sheetData>';
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), MIN);
});

test('other columns: a cell ending in D (AD, BD) is never measured', () => {
  const xml = '<sheetData>' +
    `<row r="4">${sharedCell('AD4', 0)}${sharedCell('BD4', 0)}${sharedCell('E4', 0)}</row>` +
    '</sheetData>';
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), MIN);
});

test('same column, two-digit row: D11 IS column D and is measured', () => {
  /* The brief listed D11 among "different column" siblings, but D11 is column D
     at row 11, so it must be measured. This asserts the real behaviour. */
  const xml = `<sheetData><row r="11">${sharedCell('D11', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), 53 + PAD);
});

test('self-closed cell: <c r="D4" s="7"/> contributes nothing', () => {
  const xml = `<sheetData><row r="4">${emptyCell('D4')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), MIN);
});

test('self-closed cell at a valid large row does not raise the width above the floor', () => {
  const xml = `<sheetData><row r="4">${emptyCell('D1048576')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), MIN);
});

test('self-closed cell does not disturb a measurable sibling', () => {
  const xml = '<sheetData><row r="4">' + emptyCell('D4') + sharedCell('D5', 0) + '</row></sheetData>';
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), 53 + PAD);
});

test('interior column: dimension and spans only grow', () => {
  const xml = '<worksheet><dimension ref="A1:B6"/><cols><col min="1" max="1" width="5"/></cols>' +
    '<sheetData>' +
    '<row r="3" spans="1:4"><c r="A3"/></row>' +
    `<row r="4" spans="1:2">${sharedCell('D4', 0)}</row>` +
    '<row r="6" spans="1:9"><c r="A6"/></row>' +
    '</sheetData></worksheet>';
  const out = e.setAnmerkungColumnWidth(xml, 3, [LONG]);
  assert.match(out, /<dimension ref="A1:D6"\/>/, 'dimension grows B -> D');
  assert.match(out, /<row r="3" spans="1:4">/, 'a span past D is untouched');
  assert.match(out, /<row r="4" spans="1:4">/, 'a span short of D grows');
  assert.match(out, /<row r="6" spans="1:9">/, 'a span past D is untouched');
});

test('interior column: an already-wide dimension and spans are never shrunk', () => {
  const xml = '<worksheet><dimension ref="A1:Z4"/><cols><col min="4" max="4" width="8"/></cols>' +
    `<sheetData><row r="3" spans="1:12"></row><row r="4">${sharedCell('D4', 0)}</row></sheetData></worksheet>`;
  const out = e.setAnmerkungColumnWidth(xml, 3, [LONG]);
  assert.match(out, /<dimension ref="A1:Z4"\/>/);
  assert.match(out, /<row r="3" spans="1:12">/);
});

test('cap: a 400-character note is clamped to 255', () => {
  const xml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['a'.repeat(400)])), MAX);
});

test('cap boundary: 254 keeps its fit, 255 clamps to 255', () => {
  const xml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['a'.repeat(254)])), 254 + PAD);
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['a'.repeat(255)])), MAX);
});

/* ══════════════════════════════════════════════════════════════════════════
 * Second pass: adversarial cases aimed at the NEW code paths — cellText(),
 * the t="inlineStr" branch, the t="str"/<v> branch (assets/anmerkung.js:2091-2107).
 * Expected values are the literal output the code must produce.
 * ══════════════════════════════════════════════════════════════════════════ */

/* An inline cell: text lives in <is>, not in a shared-strings table. */
const inlineCell = (ref, is) => cell(ref, `<is>${is}</is>`, ' t="inlineStr"');

/* ── inlineStr: several <t> runs inside one <is> ── */
test('inlineStr: several <t> runs are concatenated, not maxed', () => {
  /* Two runs of 30 and 25 chars join into a single 55-char line. Taking the max
     run (30) instead of the join would give 30 + PAD. */
  const is = `<t>${'a'.repeat(30)}</t><t>${'b'.repeat(25)}</t>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(`<sheetData><row r="4">${inlineCell('D4', is)}</row></sheetData>`, 3, ['x'])), 55 + PAD);
});

/* ── inlineStr: <r><t> run wrappers with <rPr> run properties ── */
test('inlineStr: <r><t> run wrappers with <rPr> are measured, and <rPr> attrs are not text', () => {
  const is =
    '<r><rPr><sz val="10"/><color rgb="FF000000"/></rPr><t>Honold berechnet die Kosten </t></r>' +
    '<r><rPr><b/><sz val="10"/></rPr><t>nach dem bisherigen Tarif</t></r>';
  /* The two runs join to the 53-char note; no <rPr> attribute leaks a character. */
  assert.equal(widthOf(e.setAnmerkungColumnWidth(`<sheetData><row r="4">${inlineCell('D4', is)}</row></sheetData>`, 3, ['x'])), 53 + PAD);
});

/* ── inlineStr: <t xml:space="preserve"> ── */
test('inlineStr: <t xml:space="preserve"> keeps trailing spaces in the count', () => {
  /* 60 X's + 3 trailing spaces = 63 chars; the attribute must not be counted. */
  const is = `<t xml:space="preserve">${'X'.repeat(60)}   </t>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(`<sheetData><row r="4">${inlineCell('D4', is)}</row></sheetData>`, 3, ['x'])), 63 + PAD);
});

/* ── inlineStr: shorter than the header -> floor still wins ── */
test('inlineStr: a note shorter than the header keeps the floor', () => {
  const is = '<t>ok</t>';
  assert.equal(widthOf(e.setAnmerkungColumnWidth(`<sheetData><row r="4">${inlineCell('D4', is)}</row></sheetData>`, 3, [LONG])), MIN);
});

test('inlineStr: an inline note shorter than the header loses to a longer inline sibling', () => {
  const xml = '<sheetData>' +
    `<row r="4">${inlineCell('D4', '<t>ok</t>')}</row>` +
    `<row r="5">${inlineCell('D5', `<t>${LONG}</t>`)}</row>` +
    '</sheetData>';
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), 53 + PAD);
});

/* ── t="str" formula-string cell: measured from its cached <v> ── */
test('str: a formula-string cell is measured from the cached <v>, not the formula', () => {
  const xml = `<sheetData><row r="4">${cell('D4', `<f>CONCAT(A1,B1)</f><v>${LONG}</v>`, ' t="str"')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), 53 + PAD);
});

test('str: a long <f> with a short <v> is measured by <v> only', () => {
  const xml = `<sheetData><row r="4">${cell('D4', `<f>${'SUM(A1:A9)'.repeat(9)}</f><v>${'y'.repeat(40)}</v>`, ' t="str"')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), 40 + PAD);
});

test('str: a formula string shorter than the header keeps the floor', () => {
  const xml = `<sheetData><row r="4">${cell('D4', '<f>x</f><v>1.5</v>', ' t="str"')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), MIN);
});

/* ── character references and &nbsp; inside a shared string ── */
test('shared string: &#x41; and &nbsp; are counted literally (no numeric-ref decode)', () => {
  /* cellText/the <v> branch decode only the five XML entities (&amp; &lt; &gt;
     &quot; &apos;), NOT numeric character references and NOT &nbsp;. So a shared
     string stored raw as "A&#x41;" counts 7 chars ("AA" = 2 if decoded), and
     "a&nbsp;b" counts 7 chars ("a b" = 3 if decoded). The observed over-count
     is NOT a defect of the new code: parseSharedStrings (assets/anmerkung.js:1930)
     decodes exactly the same five entities and also leaves both raw, and the
     only route into the <v> path is that very table, so no other decode is
     possible. (Observed widths are well above the 9.7109375 floor here.) */
  const numRef = 'A&#x41;'.repeat(11);  // 7 raw chars x11 = 77 (22 if decoded)
  const nbsp   = 'a&nbsp;b'.repeat(11); // 8 raw chars x11 = 88 (33 if decoded)
  const xml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  /* Run the real parser on the same <si> bodies to prove the fixture equals what
     parseSharedStrings emits; the width then follows from that string. */
  const parsedNumRef = parseSharedStrings(`<sst><si><t>${numRef}</t></si></sst>`)[0];
  const parsedNbsp = parseSharedStrings(`<sst><si><t>${nbsp}</t></si></sst>`)[0];
  assert.equal(parsedNumRef, numRef, 'parseSharedStrings leaves &#x41; literal');
  assert.equal(parsedNbsp, nbsp, 'parseSharedStrings leaves &nbsp; literal');
  assert.equal(parsedNumRef.length, 77, 'fixture sanity');
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [parsedNumRef])), 77 + PAD);
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [parsedNbsp])), 88 + PAD);
});

test('inlineStr: &lt; and &amp; are decoded to one char each before counting', () => {
  /* Raw "&lt;&amp;ABCDEFGH" is 16 chars; decoded it is "<&ABCDEFGH" = 10 chars,
     which is what the measured width must be (10 + PAD, still above the floor). */
  const is = `<t>${'&lt;&amp;ABCDEFGH'}</t>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(`<sheetData><row r="4">${inlineCell('D4', is)}</row></sheetData>`, 3, ['x'])), 10 + PAD);
  /* One isolated check that the entity is not counted as its literal text: 11
     "&lt;" are 11 decoded chars, not 44. */
  const is2 = `<t>${'&lt;'.repeat(11)}</t>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(`<sheetData><row r="4">${inlineCell('D4', is2)}</row></sheetData>`, 3, ['x'])), 11 + PAD);
});

/* ── whitespace-only and xml:space <v> ── */
test('whitespace-only <v> shorter than the header keeps the floor', () => {
  const xml = `<sheetData><row r="4">${cell('D4', '<v>     </v>')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), MIN);
});

test('whitespace-only <v> longer than the header is counted as spaces', () => {
  /* 12 spaces: '   ' is not stripped, so 12 + PAD; the floor is 9.7109375. */
  const xml = `<sheetData><row r="4">${cell('D4', `<v>${' '.repeat(12)}</v>`)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), 12 + PAD);
});

test('<v xml:space="preserve"> is measured from its text, attribute ignored', () => {
  const xml = `<sheetData><row r="4">${cell('D4', `<v xml:space="preserve">${LONG}</v>`)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), 53 + PAD);
});

/* ── the inlineStr branch must not fire outside column D ── */
test('inlineStr in another column (DA/DD/AD/BD) is never measured', () => {
  const is = `<t>${LONG}</t>`;
  const refs = [['DA', 4], ['DD', 4], ['AD', 4], ['BD', 4], ['DA', 11], ['DD', 11]];
  for (const [col, row] of refs) {
    const xml = `<sheetData><row r="${row}">${inlineCell(col + row, is)}</row></sheetData>`;
    assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), MIN, `${col}${row} must not widen column D`);
  }
});

test('inlineStr: D11 is column D and IS measured, unlike DA11', () => {
  const is = `<t>${LONG}</t>`;
  const d11 = `<sheetData><row r="11">${inlineCell('D11', is)}</row></sheetData>`;
  const da11 = `<sheetData><row r="11">${inlineCell('DA11', is)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(d11, 3, ['x'])), 53 + PAD);
  assert.equal(widthOf(e.setAnmerkungColumnWidth(da11, 3, ['x'])), MIN);
});

test('str in another column (DA4) is never measured', () => {
  const xml = `<sheetData><row r="4">${cell('DA4', `<f>x</f><v>${LONG}</v>`, ' t="str"')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), MIN);
});

/* ── cap boundary and "no single note can exceed the cap" ── */
test('cap: 254-char notes keep their fit, 255 clamp, for BOTH shared and inline strings', () => {
  const sharedXml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  const inlineXml = `<sheetData><row r="4">${inlineCell('D4', `<t>${'a'.repeat(254)}</t>`)}</row></sheetData>`;
  const inline255 = `<sheetData><row r="4">${inlineCell('D4', `<t>${'a'.repeat(255)}</t>`)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(sharedXml, 3, ['a'.repeat(254)])), 254 + PAD);
  assert.equal(widthOf(e.setAnmerkungColumnWidth(inlineXml, 3, ['x'])), 254 + PAD);
  assert.equal(widthOf(e.setAnmerkungColumnWidth(inline255, 3, ['x'])), MAX);
});
test('cap: no single note can push the width past 255', () => {
  const huge = 'z'.repeat(5000);
  const sharedXml = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  const inlineXml = `<sheetData><row r="4">${inlineCell('D4', `<t>${huge}</t>`)}</row></sheetData>`;
  const multiLine = `<sheetData><row r="4">${sharedCell('D4', 0)}</row></sheetData>`;
  for (const [label, xml, str] of [
    ['shared', sharedXml, [huge]],
    ['inline', inlineXml, ['x']],
    ['shared multi-line', multiLine, [`${'q'.repeat(400)}\n${'r'.repeat(300)}`]],
  ]) {
    const got = widthOf(e.setAnmerkungColumnWidth(xml, 3, str));
    assert.ok(got <= MAX, `${label}: ${got} must not exceed ${MAX}`);
    assert.equal(got, MAX, `${label}: must saturate at the cap`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THIRD PASS — lock the four post-review fixes (see .agent/artifacts/tests.md).
 *
 * Before every fix the scan regex used a GREEDY attribute run `[^>]*` before
 * `(?:\/>|>([\s\S]*?)<\/c>)`. Greedy matching eats the `/` of a self-closed
 * target cell, so the regex falls through to the `>` branch and swallows every
 * byte up to the NEXT `</c>` — a later cell's `<v>`, measured as if it were
 * column D's. Each case below therefore pins one of:
 *   F1 lazy attribute run (self-closed cells stop the scan),
 *   F2 numeric character-reference decoding in cellText,
 *   F3 the inlineStr branch keeping its <v> (no `continue`),
 *   F4 the U+10FFFF guard on numeric references.
 * "before" notes reconstruct the pre-fix engine by hand (scratch copy under
 * .tmp/, never assets/anmerkung.js).
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── F1: the lazy attribute run — a self-closed target cell must NOT swallow a neighbour ── */

test('F1 over-span: self-closed D4 followed by a DIFFERENT column must not widen D', () => {
  /* The exact regression from the task brief. Pre-fix the regex consumed
     `r="D4" s="7"/><c r="E4" t="s">` and measured E4's shared string, 10
     chars -> 10.7109375. D4 itself is empty, so D stays at the floor 9.7109375.
     The neighbour's note is 10 chars, one above the 9-char header, which is why
     the bug is visible: 10.7109375 (wrong) vs 9.7109375 (right). */
  const xml = `<sheetData><row r="4">${emptyCell('D4')}${sharedCell('E4', 0)}</row></sheetData>`;
  assert.doesNotThrow(() => e.setAnmerkungColumnWidth(xml, 3, ['1234567890']));
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['1234567890'])), MIN);
  assert.notEqual(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['1234567890'])), 10.7109375);
});

test('F1 over-span: the same trap with a LONG note in a neighbour would be far worse', () => {
  /* E4 carries the 53-char LONG note. Pre-fix: D measured 53 -> 53.7109375,
     a 44-character over-widen of a column holding nothing. Post-fix: 9.7109375. */
  const xml = `<sheetData><row r="4">${emptyCell('D4')}${sharedCell('E4', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), MIN);
});

test('F1 over-span: self-closed D4 adjacent to DA4 and to DD4 must not widen D', () => {
  /* DA and DD are genuinely other columns (their shared string in the table is
     never reached for a D cell). Pre-fix, greedy swallowed DA4/DD4's <v> and D
     measured 53 -> 53.7109375. Post-fix: 9.7109375. */
  const da = `<sheetData><row r="4">${emptyCell('D4')}${sharedCell('DA4', 0)}</row></sheetData>`;
  const dd = `<sheetData><row r="4">${emptyCell('D4')}${sharedCell('DD4', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(da, 3, [LONG])), MIN);
  assert.equal(widthOf(e.setAnmerkungColumnWidth(dd, 3, [LONG])), MIN);
});

test('F1 over-span: DA is still measured when DA itself is the target (trap is D-specific)', () => {
  /* Proves the DA cases above are about the D lookahead, not a blanket DA
     exclusion. colToIdx('DA') = 4*26 + 1 - 1 = 104, so the target index is 104
     and the <col> is min="105" max="105". */
  const xml = `<sheetData><row r="4">${sharedCell('DA4', 0)}</row></sheetData>`;
  const out = e.setAnmerkungColumnWidth(xml, 104, [LONG]);
  const tag = /<col\b[^>]*\bmin="105"[^>]*\bmax="105"[^>]*\/>/.exec(out);
  assert.equal(Number(/width="([^"]+)"/.exec(tag[0])[1]), 53 + PAD);
});

test('F1 over-span: self-closed D4 as the last cell before </row>', () => {
  /* `...</c></row>` — the very next `</c>` would have been the previous cell on
     the row; here D4 ends the row and the E5 note in the NEXT row is column E,
     so D must stay at the floor (both engines agree; this pins the boundary). */
  const xml = `<sheetData><row r="4">${emptyCell('D4')}</row><row r="5">${sharedCell('E5', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), MIN);
});

test('F1 over-span: self-closed D4 as the last cell before </sheetData>', () => {
  /* D4 ends the last row and nothing follows it, so there is no later `</c>`
     for a greedy body to swallow: both the pre-fix and post-fix engines return
     the floor here. This is a boundary pin (the scan must terminate cleanly at
     the document end), NOT a discriminator. */
  const xml = `<sheetData><row r="4">${emptyCell('D4')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, [LONG])), MIN);

  /* Same shape with an E-bearing neighbour before it on the last row: E4 is
     column E, so D still floors. Also non-discriminating (nothing follows D4). */
  const withE = `<sheetData><row r="4">${sharedCell('E4', 0)}${emptyCell('D4')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(withE, 3, [LONG])), MIN);

  /* A genuine D note in an earlier row must still be measured when the last
     row's D4 is self-closed. */
  const earlier = `<sheetData><row r="3">${sharedCell('D3', 0)}</row><row r="4">${emptyCell('D4')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(earlier, 3, [LONG])), 53 + PAD);
});

test('F1 over-span: self-closed D4 adjacent to a two-digit row (D4 vs D11) in one sheet', () => {
  /* D11 is a genuine D cell, so post-fix it IS measured (53.7109375); the test
     pins the value AND that an adjacent E11 long note stays out of the D scan. */
  const realNote = `<sheetData><row r="4">${emptyCell('D4')}</row><row r="11">${sharedCell('D11', 0)}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(realNote, 3, [LONG])), 53 + PAD);

  const shortD11LongE11 = `<sheetData><row r="4">${emptyCell('D4')}</row><row r="11">${sharedCell('D11', 0)}${sharedCell('E11', 1)}</row></sheetData>`;
  /* D11's note is 10 chars, E11's is the 53-char LONG. Post-fix D = 10.7109375. */
  assert.equal(widthOf(e.setAnmerkungColumnWidth(shortD11LongE11, 3, ['1234567890', LONG])), 10.7109375);

  const longE11Only = `<sheetData><row r="4">${emptyCell('D4')}</row><row r="11">${sharedCell('E11', 0)}</row></sheetData>`;
  /* Pre-fix greedy swallowed E11's <v>; post-fix nothing in D -> floor. */
  assert.equal(widthOf(e.setAnmerkungColumnWidth(longE11Only, 3, [LONG])), MIN);
});

/* ── F2/F4: numeric character references in an inline string ── */

test('F2/F4 numeric refs: malformed and out-of-range references neither throw nor mis-measure', () => {
  /* Fixture base: 10 ASCII letters, measured with an inline <t> only, so the
     string's character count is exactly the width driver (floor is 9.7109375).
     Expected char counts (derived from cellText):
       13 = base + '&#;'             (invalid: left literal, 3 chars)
       14 = base + '&#x;'            (invalid: left literal, 4 chars)
       16 = base + '&#xZZ;'          (invalid hex: left literal, 6 chars)
       11 = base + '&'               (lone ampersand: left literal, 1 char)
       20 = base + '&#x110000;'      (guarded: left literal, 10 chars)
       25 = base + '&#999999999999;' (guarded: left literal, 15 chars)
       11 = base + '&#65;'           (valid: 'A', 1 char)
       11 = base + '&#x41;'          (valid: 'A', 1 char)
     Pre-fix the two guarded refs THREW a RangeError out of
     setAnmerkungColumnWidth (String.fromCodePoint rejects U+110000 and 1e12);
     the guard keeps them literal. The two VALID refs were not decoded by the
     pre-fix cellText either (it left all numeric refs literal), so they would
     have measured 15.7109375 / 16.7109375. */
  const base = 'abcdefghij';
  const refs = [
    ['&#;', 13],             // literal 3 -> 13
    ['&#x;', 14],            // literal 4 -> 14
    ['&#xZZ;', 16],          // literal 6 -> 16
    ['&', 11],               // literal 1 -> 11
    ['&#x110000;', 20],      // guarded 10 -> 20
    ['&#999999999999;', 25], // guarded 15 -> 25
    ['&#65;', 11],           // 'A' 1 -> 11
    ['&#x41;', 11],          // 'A' 1 -> 11
  ];
  for (const [raw, chars] of refs) {
    const xml = `<sheetData><row r="4">${inlineCell('D4', `<t>${base}${raw}</t>`)}</row></sheetData>`;
    assert.doesNotThrow(() => e.setAnmerkungColumnWidth(xml, 3, ['x']), `${raw} must not throw`);
    assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), chars + PAD, `${raw} -> ${chars} chars`);
  }
});

test('F4 numeric refs: the guard is exact at the U+10FFFF boundary, literal just above', () => {
  /* 9 letters sit at the 9.7109375 floor, so a decoded code point is invisible;
     the decoded-vs-literal split only shows with a longer base. U+10FFFF (max
     valid) decodes to one char (10 chars total); U+110000 stays literal. */
  const nine = 'abcdefghi';
  const inRange = `<sheetData><row r="4">${inlineCell('D4', `<t>${nine}&#x10FFFF;</t>`)}</row></sheetData>`;
  const overRange = `<sheetData><row r="4">${inlineCell('D4', `<t>${nine}&#x110000;</t>`)}</row></sheetData>`;
  assert.doesNotThrow(() => e.setAnmerkungColumnWidth(overRange, 3, ['x']));
  assert.equal(widthOf(e.setAnmerkungColumnWidth(inRange, 3, ['x'])), 10 + PAD, 'U+10FFFF decodes to one char');
  assert.equal(widthOf(e.setAnmerkungColumnWidth(overRange, 3, ['x'])), 19 + PAD, 'U+110000 stays literal (10 chars)');
});

/* ── F3: an inline cell that ALSO carries a <v> measures the longer of the two ── */

test('F3 inlineStr+<v>: an inline cell carrying both an <is><t> and a <v> measures the longer', () => {
  /* Pre-fix the inlineStr branch ended in `continue`, so the inline text decided
     alone. The two fixtures now measure the larger of the two runs:
       - short text 'SHORT' (5 chars) + 40-char <v> -> 40.7109375 (pre-fix 9.7109375)
       - 53-char text + short <v> '12' (2 chars)   -> 53.7109375 (both engines agree) */
  const vLong = `<sheetData><row r="4">${cell('D4', '<is><t>SHORT</t></is><v>' + 'y'.repeat(40) + '</v>', ' t="inlineStr"')}</row></sheetData>`;
  const textLong = `<sheetData><row r="4">${cell('D4', `<is><t>${LONG}</t></is><v>12</v>`, ' t="inlineStr"')}</row></sheetData>`;
  assert.equal(widthOf(e.setAnmerkungColumnWidth(vLong, 3, ['x'])), 40 + PAD);
  assert.equal(widthOf(e.setAnmerkungColumnWidth(textLong, 3, ['x'])), 53 + PAD);
});

/* ── F3 positive control: a t="str" formula cell is still measured from <v>, not <f> ── */

test('F3 str: a formula-string cell is measured by its <v>, never by its very long <f>', () => {
  /* t="str" is NOT inlineStr, so the inline branch does not run; the <v> is the
     cached result Excel shows. A long <f> must be ignored: the formula here is
     60 chars, the value 12, so the width is 12.7109375. */
  const formula = 'SUM(A1:A9)'.repeat(6); // 60 chars
  const xml = `<sheetData><row r="4">${cell('D4', `<f>${formula}</f><v>123456789012</v>`, ' t="str"')}</row></sheetData>`;
  assert.equal(formula.length, 60, 'fixture sanity');
  assert.equal(widthOf(e.setAnmerkungColumnWidth(xml, 3, ['x'])), 12 + PAD);
});
