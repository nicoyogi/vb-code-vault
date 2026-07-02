/* Unit tests for the pure extract/split helpers in File_splitter.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSplitter } from './harness/load-splitter.mjs';

const s = loadSplitter();
// vm-realm arrays/objects have a foreign prototype; JSON round-trip re-homes
// them so deepStrictEqual compares by value.
const plain = x => JSON.parse(JSON.stringify(x));

test('pickColumns: finds the 3 targets by name regardless of order', () => {
  // [Vendor details, Supplier, Document number] -> their indices
  assert.deepEqual(plain(s.pickColumns(['Document number', 'Vendor details', 'x', 'Supplier'])), [1, 3, 0]);
  assert.deepEqual(plain(s.pickColumns([' Vendor details ', 'Supplier', 'Document number'])), [0, 1, 2]); // trims
  assert.equal(s.pickColumns(['Vendor details', 'Supplier']), null); // missing Document number
});

test('extractRows: projects to [vendor,supplier,doc,notes[]], collects Note cells, drops blank-vendor rows', () => {
  const rows = [
    // vendor,    supplier, doc,  note@3,   note@4
    ['DHL',      '111', 'D1', '',      'kreditor fehlt'],
    ['',         '222', 'D2', 'x',     ''],              // blank vendor -> dropped
    ['Schenker', '444', 'D4', 'noteA', 'noteB'],         // two note cells -> both kept, separate
    ['Kuehne',   '555', 'D5', '',      ''],              // no note -> []
  ];
  assert.deepEqual(plain(s.extractRows(rows, [0, 1, 2], [3, 4])), [
    ['DHL', '111', 'D1', ['kreditor fehlt']],
    ['Schenker', '444', 'D4', ['noteA', 'noteB']],
    ['Kuehne', '555', 'D5', []],
  ]);
});

test('noteColumns: every column literally named "Note"', () => {
  assert.deepEqual(plain(s.noteColumns(['A', 'Note', 'B', 'Note', 'Note'])), [1, 3, 4]);
  assert.deepEqual(plain(s.noteColumns(['A', 'B'])), []);
});

test('noteKeep: no notes always kept; else any note value in the checked set', () => {
  const checked = new Set(['fehlende Kreditorenangabe', 'Kreditor fehlt']);
  assert.equal(s.noteKeep([], checked), true);                              // blank -> always kept
  assert.equal(s.noteKeep(['fehlende Kreditorenangabe'], checked), true);
  assert.equal(s.noteKeep(['Falschabrechnung Diesel'], checked), false);    // exact value, no substring
  assert.equal(s.noteKeep(['Falschabrechnung Diesel', 'Kreditor fehlt'], checked), true); // any-match
  assert.equal(s.noteKeep(['anything'], new Set()), false);                 // nothing checked -> noted rows drop
});

test('tallyForwarders: counts per vendor, sorted desc', () => {
  const rows = [['DHL', '', '1'], ['Schenker', '', '2'], ['DHL', '', '3']];
  assert.deepEqual(plain(s.tallyForwarders(rows)), [{ name: 'DHL', count: 2 }, { name: 'Schenker', count: 1 }]);
});

test('tallyNotes: counts each note value across all rows, sorted desc', () => {
  const rows = [
    ['DHL', '', '1', ['A', 'B']],
    ['DHL', '', '2', ['A']],
    ['SCH', '', '3', []],
  ];
  assert.deepEqual(plain(s.tallyNotes(rows)), [{ name: 'A', count: 2 }, { name: 'B', count: 1 }]);
});

test('balancedSizes: spreads remainder to the front, sums to n', () => {
  assert.deepEqual(plain(s.balancedSizes(5, 4)), [2, 1, 1, 1]);
  assert.deepEqual(plain(s.balancedSizes(8, 4)), [2, 2, 2, 2]);
  assert.deepEqual(plain(s.balancedSizes(0, 3)), [0, 0, 0]);
  const sizes = s.balancedSizes(79, 3);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 79); // nothing lost/duplicated
});

test('systemName: strips the extension', () => {
  assert.equal(s.systemName('OPP.XLSX'), 'OPP');
  assert.equal(s.systemName('KSP.xlsx'), 'KSP');
  assert.equal(s.systemName('weird'), 'weird');
});

test('docNumDesc: sorts rows by Document number Z→A, numeric-aware, blanks last', () => {
  const r = d => ['V', 'S', d, []];
  const rows = [r('9'), r('D-2'), r(''), r('10'), r(100), r('D-10')];
  const sorted = [...rows].sort(s.docNumDesc).map(x => String(x[2]));
  assert.deepEqual(plain(sorted), ['D-10', 'D-2', '100', '10', '9', '']);
});

test('colWidths: per-column max content length +2, clamped to [12, 44]', () => {
  const header = ['Vendor details', 'Supplier', 'Document number'];
  const rows = [
    ['Schenker Deutschland AG, Nuernberg', '12345', 'D1'],
    ['DHL', 'x'.repeat(60), 4711],
  ];
  assert.deepEqual(plain(s.colWidths(header, rows)), [
    { wch: 36 }, // 34 + 2
    { wch: 44 }, // 62 capped
    { wch: 17 }, // header 'Document number' (15) + 2
  ]);
  assert.deepEqual(plain(s.colWidths(['A', 'B', 'C'], [])),
    [{ wch: 12 }, { wch: 12 }, { wch: 12 }]); // floor
});
