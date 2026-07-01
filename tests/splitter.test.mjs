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

test('extractRows: projects to [vendor,supplier,doc,note], merges Note cells, drops blank-vendor rows', () => {
  const rows = [
    // vendor,    supplier, doc,  note@3,   note@4
    ['DHL',      '111', 'D1', '',      'kreditor fehlt'],
    ['',         '222', 'D2', 'x',     ''],              // blank vendor -> dropped
    ['Schenker', '444', 'D4', 'noteA', 'noteB'],         // two note cells -> merged
    ['Kuehne',   '555', 'D5', '',      ''],              // no note -> ''
  ];
  assert.deepEqual(plain(s.extractRows(rows, [0, 1, 2], [3, 4])), [
    ['DHL', '111', 'D1', 'kreditor fehlt'],
    ['Schenker', '444', 'D4', 'noteA | noteB'],
    ['Kuehne', '555', 'D5', ''],
  ]);
});

test('noteColumns: every column literally named "Note"', () => {
  assert.deepEqual(plain(s.noteColumns(['A', 'Note', 'B', 'Note', 'Note'])), [1, 3, 4]);
  assert.deepEqual(plain(s.noteColumns(['A', 'B'])), []);
});

test('parseNoteTerms: lowercased, split on newline/semicolon, trimmed', () => {
  assert.deepEqual(plain(s.parseNoteTerms('Fehlende Kreditorenangabe\n Kreditor fehlt ;;')),
    ['fehlende kreditorenangabe', 'kreditor fehlt']);
  assert.deepEqual(plain(s.parseNoteTerms('   ')), []);
  assert.deepEqual(plain(s.parseNoteTerms('')), []);
});

test('noteKeep: blank always kept; no terms keeps all; else substring match (any term)', () => {
  assert.equal(s.noteKeep('', ['x']), true);                 // blank note -> always kept
  assert.equal(s.noteKeep('anything', []), true);            // no terms -> keep all
  assert.equal(s.noteKeep('fehlende Kreditorenangabe Bitte…', ['fehlende kreditorenangabe']), true);
  assert.equal(s.noteKeep('Falschabrechnung Diesel', ['fehlende kreditorenangabe']), false);
  assert.equal(s.noteKeep('Kreditor fehlt', ['fehlende kreditorenangabe', 'kreditor fehlt']), true);
});

test('tallyForwarders: counts per vendor, sorted desc', () => {
  const rows = [['DHL', '', '1'], ['Schenker', '', '2'], ['DHL', '', '3']];
  assert.deepEqual(plain(s.tallyForwarders(rows)), [{ name: 'DHL', count: 2 }, { name: 'Schenker', count: 1 }]);
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
