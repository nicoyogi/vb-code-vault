/* Unit tests for the pure extract/split helpers and the forwarder-checklist
   and last-output persistence helpers (fileSplitter.forwarders,
   fileSplitter.lastOutput) in File_splitter.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSplitter } from './harness/load-splitter.mjs';

const s = loadSplitter();
// vm-realm arrays/objects have a foreign prototype; JSON round-trip re-homes
// them so deepStrictEqual compares by value.
const plain = x => JSON.parse(JSON.stringify(x));

const FORWARDER_KEY = 'fileSplitter.forwarders';
const LAST_OUTPUT_KEY = 'fileSplitter.lastOutput';

test('pickColumns: finds the 4 targets by name regardless of order', () => {
  // [Vendor details, Supplier, Reference, Document number] -> their indices
  assert.deepEqual(plain(s.pickColumns(['Document number', 'Vendor details', 'Reference', 'x', 'Supplier'])), [1, 4, 2, 0]);
  assert.deepEqual(plain(s.pickColumns([' Vendor details ', 'Supplier', 'Reference', 'Document number'])), [0, 1, 2, 3]); // trims
  assert.equal(s.pickColumns(['Vendor details', 'Supplier', 'Document number']), null); // missing Reference
});

test('extractRows: projects to [vendor,supplier,ref,doc,notes[],overdue], collects Note cells, drops blank-vendor rows', () => {
  const due = new Date(2026, 6, 13);
  const rows = [
    // vendor,    supplier, ref, doc,  note@4,   note@5,           overdue@6
    ['DHL',      '111', 'R1', 'D1', '',      'kreditor fehlt', due],
    ['',         '222', 'R2', 'D2', 'x',     '',               ''], // blank vendor -> dropped
    ['Schenker', '444', 'R4', 'D4', 'noteA', 'noteB',          ''], // two note cells -> both kept, separate
    ['Kuehne',   '555', 'R5', 'D5', '',      '',               ''], // no note -> []
  ];
  assert.deepEqual(plain(s.extractRows(rows, [0, 1, 2, 3], [4, 5], 6)), plain([
    ['DHL', '111', 'R1', 'D1', ['kreditor fehlt'], due],
    ['Schenker', '444', 'R4', 'D4', ['noteA', 'noteB'], ''],
    ['Kuehne', '555', 'R5', 'D5', [], ''],
  ]));
  // no overdue column (default arg) -> index 5 is ''
  assert.deepEqual(plain(s.extractRows([['V', 'S', 'R', 'D', 'n']], [0, 1, 2, 3], [4])),
    [['V', 'S', 'R', 'D', ['n'], '']]);
});

test('workbookEntries: picks up the optional Overdue in workflow from column', () => {
  // overdue header mid-row, not last — pickup is position-independent
  const H = ['Vendor details', 'Supplier', 'Overdue in workflow from', 'Reference', 'Document number'];
  const due = new Date(2026, 6, 13);
  const res = s.workbookEntries([{ name: 'S1', rows: [H, ['DHL', 'S', due, 'R', 'D1']] }], 'FNP.xlsx');
  assert.deepEqual(plain(res.entries[0].rows), plain([['DHL', 'S', 'R', 'D1', [], due]]));
});

test('noteColumns: every column literally named "Note"', () => {
  assert.deepEqual(plain(s.noteColumns(['A', 'Note', 'B', 'Note', 'Note'])), [1, 3, 4]);
  assert.deepEqual(plain(s.noteColumns(['A', 'B'])), []);
});

test('noteKeep: no notes always kept; else EVERY note value must be checked', () => {
  const checked = new Set(['fehlende Kreditorenangabe', 'Kreditor fehlt']);
  assert.equal(s.noteKeep([], checked), true);                              // blank -> always kept
  assert.equal(s.noteKeep(['fehlende Kreditorenangabe'], checked), true);
  assert.equal(s.noteKeep(['Falschabrechnung Diesel'], checked), false);    // exact value, no substring
  assert.equal(s.noteKeep(['Falschabrechnung Diesel', 'Kreditor fehlt'], checked), false); // one unchecked note drops the row
  assert.equal(s.noteKeep(['fehlende Kreditorenangabe', 'Kreditor fehlt'], checked), true); // all checked -> kept
  assert.equal(s.noteKeep(['anything'], new Set()), false);                 // nothing checked -> noted rows drop
});

test('tallyForwarders: counts per vendor, sorted A-Z by name', () => {
  const rows = [['Zebra Sped', '', '1'], ['Zebra Sped', '', '2'], ['Alpha Log', '', '3']];
  assert.deepEqual(plain(s.tallyForwarders(rows)), [{ name: 'Alpha Log', count: 1 }, { name: 'Zebra Sped', count: 2 }]);
});

test('tallyNotes: counts each note value across all rows, sorted desc', () => {
  const rows = [
    ['DHL', '', 'r', '1', ['A', 'B']],
    ['DHL', '', 'r', '2', ['A']],
    ['SCH', '', 'r', '3', []],
  ];
  assert.deepEqual(plain(s.tallyNotes(rows)), [{ name: 'A', count: 2 }, { name: 'B', count: 1 }]);
});

test('balancedSizes: spreads remainder to the front (equal weights), sums to n', () => {
  assert.deepEqual(plain(s.balancedSizes(5, [1, 1, 1, 1])), [2, 1, 1, 1]);
  assert.deepEqual(plain(s.balancedSizes(8, [1, 1, 1, 1])), [2, 2, 2, 2]);
  assert.deepEqual(plain(s.balancedSizes(0, [1, 1, 1])), [0, 0, 0]);
  const sizes = s.balancedSizes(79, [1, 1, 1]);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 79); // nothing lost/duplicated
});

test('balancedSizes: proportional to weights, sums to n (largest-remainder)', () => {
  assert.deepEqual(plain(s.balancedSizes(9, [1, 0.5])), [6, 3]);          // weights 1:0.5 -> 2:1
  assert.deepEqual(plain(s.balancedSizes(10, [1, 1, 0.5])), [4, 4, 2]);   // weights 1:1:0.5 -> 2:2:1
  assert.deepEqual(plain(s.balancedSizes(100, [1, 0.5, 0.5])), [50, 25, 25]);
  // edge cases
  assert.deepEqual(plain(s.balancedSizes(0, [1, 0.5])), [0, 0]);          // nothing to give
  assert.deepEqual(plain(s.balancedSizes(3, [0.5])), [3]);                // single half-day person takes all
  assert.deepEqual(plain(s.balancedSizes(6, [1, 1])), [3, 3]);            // all full -> equal (old balancedSizes(6,2))
  const sizes = s.balancedSizes(79, [1, 1, 1]);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 79);                     // nothing lost/duplicated
});

test('weightsForNames: a half-day person carries half a full-day weight', () => {
  assert.deepEqual(plain(s.weightsForNames(['Ana', 'Ben'], new Set(['Ben']))), [1, 0.5]);
  assert.deepEqual(plain(s.weightsForNames(['A', 'B', 'C', 'D'], new Set(['D']))), [1, 1, 1, 0.5]);
  assert.deepEqual(plain(s.weightsForNames(['A', 'B'], new Set())), [1, 1]);
  assert.deepEqual(plain(s.weightsForNames(['A', 'B'], new Set(['A', 'B']))), [0.5, 0.5]);
});

test('allocateJobShares: whole-job targets, spread evenly across systems', () => {
  // 3 full + 1 half over one 280-row job -> exactly 80/80/80/40
  assert.deepEqual(plain(s.allocateJobShares([280], [1, 1, 1, 0.5])), [[80, 80, 80, 40]]);
  // Three 8-row systems: per-system rounding alone piles onto one person
  // ([3,2,2,1] three times -> 9/6/6/3); the plan keeps the totals 7/7/7/3.
  const plan = s.allocateJobShares([8, 8, 8], [1, 1, 1, 0.5]);
  assert.deepEqual(plain(plan), [[3, 2, 2, 1], [2, 3, 2, 1], [2, 2, 3, 1]]);
  plan.forEach(sizes => assert.equal(sizes.reduce((a, b) => a + b, 0), 8));
  assert.deepEqual([0, 1, 2, 3].map(i => plan.reduce((a, sizes) => a + sizes[i], 0)), [7, 7, 7, 3]);
  // empty systems and the running remainder still preserve the totals
  const withEmpty = s.allocateJobShares([0, 10, 0, 5], [1, 1]);
  assert.deepEqual(plain(withEmpty), [[0, 0], [5, 5], [0, 0], [3, 2]]);
  assert.deepEqual(plain(s.allocateJobShares([0, 0], [1, 1])), [[0, 0], [0, 0]]);
});

test('sliceBounds: contiguous [start,end) bands proportional to weights, covers all n', () => {
  assert.deepEqual(plain(s.sliceBounds(6, [1, 0.5])), [[0, 4], [4, 6]]);       // 4:2
  assert.deepEqual(plain(s.sliceBounds(0, [1, 0.5])), [[0, 0], [0, 0]]);
  const b = s.sliceBounds(79, [1, 1, 1]);
  assert.equal(b[0][0], 0);
  assert.equal(b[b.length - 1][1], 79);                                  // covers everything
  for (let i = 1; i < b.length; i++) assert.equal(b[i][0], b[i - 1][1]); // no gaps, no overlap
});

test('systemName: strips the extension', () => {
  assert.equal(s.systemName('OPP.XLSX'), 'OPP');
  assert.equal(s.systemName('KSP.xlsx'), 'KSP');
  assert.equal(s.systemName('weird'), 'weird');
});

test('docNumDesc: sorts rows by Document number Z→A, numeric-aware, blanks last', () => {
  const r = d => ['V', 'S', 'R', d, []];
  const rows = [r('9'), r('D-2'), r(''), r('10'), r(100), r('D-10')];
  const sorted = [...rows].sort(s.docNumDesc).map(x => String(x[3]));
  assert.deepEqual(plain(sorted), ['D-10', 'D-2', '100', '10', '9', '']);
});

test('outputRowOrder: forwarder A→Z, then Document number Z→A within each forwarder', () => {
  const r = (v, d) => [v, 'S', 'R', d, []];
  const rows = [r('Beta', '9'), r('Alpha', '10'), r('Beta', '100'), r('Alpha', '9')];
  const sorted = [...rows].sort(s.outputRowOrder).map(x => `${x[0]}:${x[3]}`);
  assert.deepEqual(plain(sorted), ['Alpha:10', 'Alpha:9', 'Beta:100', 'Beta:9']);
});

test('systemRank: fixed FNP→KSP→OPP→PS1 order, unknown names after, case/substring tolerant', () => {
  const names = ['PS1', 'zzz extra', 'Export FNP 02.07', 'opp', 'KSP'];
  const sorted = [...names].sort((a, b) => s.systemRank(a) - s.systemRank(b));
  assert.deepEqual(plain(sorted), ['Export FNP 02.07', 'KSP', 'opp', 'PS1', 'zzz extra']);
});

test('normDoc: stringifies and trims, null/undefined -> empty', () => {
  assert.equal(s.normDoc(' 5093162 '), '5093162');
  assert.equal(s.normDoc(5116690), '5116690');
  assert.equal(s.normDoc(null), '');
});

test('prioDocsFromSheet: walks actual cells (not !ref), per-header column, skips blanks and repeated headers', () => {
  const sheet = {
    '!ref': 'A1:U1048576',            // stretched range must not matter
    A1: { v: 'SAP' }, G1: { v: 'Dokumentnummer' }, H1: { v: 'Document number' },
    A2: { v: 'FNP' }, G2: { v: '5093162' }, H2: { v: 'D-1' },
    G3: { v: 5116690 },               // numeric cell -> collected as string
    G4: { v: '  ' },                  // blank -> skipped
    G5: { v: 'Dokumentnummer' },      // stacked export header -> not a value
    G6: { v: '5126962' },
    F3: { v: '9999' },                // non-doc column -> ignored
    B9: { v: 'Dokumentnummer' },      // header mid-sheet: only rows below it count
    B2: { v: 'above-header' }, B10: { v: '7777' },
  };
  assert.deepEqual(plain(s.prioDocsFromSheet(sheet)).sort(),
    ['5093162', '5116690', '5126962', '7777', 'D-1'].sort());
  assert.deepEqual(plain(s.prioDocsFromSheet({ '!ref': 'A1:B2', A1: { v: 'no headers here' } })), []);
});

test('prioRowsFromSheet: parses German headers, extracts [vendor, supplier, ref, doc, notes[], overdue]', () => {
  const sheet = {
    '!ref': 'A1:U1000',
    A1: { v: 'SAP' }, B1: { v: 'Kreditordetails' }, C1: { v: 'Dokumentnummer' },
    D1: { v: 'Kreditor' }, E1: { v: 'Referenz' }, F1: { v: 'Schrittbezeichnung' },
    G1: { v: 'Überfällig im Workflow ab' }, H1: { v: 'Notiz' },
    A2: { v: 'FNP' }, B2: { v: 'Schenker' }, C2: { v: '5001' },
    D2: { v: '18000' }, E2: { v: 'REF-101' }, F2: { v: 'Tarifarische Prüfung' },
    G2: { v: '2026-07-06' }, H2: { v: 'prio note' },
    A3: { v: 'KSP' }, B3: { v: 'DHL' }, C3: { v: '6001' },
    D3: { v: '19000' }, E3: { v: 'REF-201' }, F3: { v: 'Faktuale Prüfung' },
    G3: { v: '' }, H3: { v: '' },
    // repeated header row should be skipped
    A4: { v: 'SAP' }, B4: { v: 'Kreditordetails' }, C4: { v: 'Dokumentnummer' },
  };
  const entries = s.prioRowsFromSheet(sheet, '19.08.2026');
  assert.equal(entries.length, 2);
  assert.deepEqual(plain(entries[0]), {
    system: 'FNP',
    group: 'tariff',
    row: ['Schenker', '18000', 'REF-101', '5001', ['prio note'], '2026-07-06']
  });
  assert.deepEqual(plain(entries[1]), {
    system: 'KSP',
    group: 'factual',
    row: ['DHL', '19000', 'REF-201', '6001', [], '']
  });
});

test('prioRowsFromSheet: ad-hoc sheet (OPP K&N) infers system and vendor from sheet name', () => {
  const sheet = {
    '!ref': 'A1:H100',
    A1: { v: 'Dokumentnummer' }, B1: { v: 'FI / MM Beleg' }, D1: { v: 'Kreditor' }, H1: { v: 'Referenz' },
    A2: { v: '2457574' }, D2: { v: 'A3001883' }, H2: { v: '77283304' },
  };
  const entries = s.prioRowsFromSheet(sheet, 'OPP K&N');
  assert.equal(entries.length, 1);
  assert.deepEqual(plain(entries[0]), {
    system: 'OPP',
    group: 'tariff',
    row: ['K&N', 'A3001883', '77283304', '2457574', [], '']
  });
});

test('reconcilePrio: missing Referenz rows added to system, existing Referenz skipped, missing systems created', () => {
  const systems = [
    { name: 'FNP', group: 'tariff', rows: [['DHL', 'K1', 'REF-1', 'D1', [], '']] },
    { name: 'KSP', group: 'tariff', rows: [['DHL', 'K2', 'REF-2', 'D2', [], '']] },
  ];
  const prioEntries = [
    { system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] },        // already in normal file -> skipped
    { system: 'FNP', group: 'tariff', row: ['Schenker', 'K1', 'REF-NEW-1', 'D10', [], ''] }, // missing in normal file -> added
    { system: 'OPP', group: 'tariff', row: ['Kuehne', 'K3', 'REF-OPP-1', 'D20', [], ''] },    // system missing in normal files -> created
  ];
  const added = s.reconcilePrio(systems, prioEntries);
  assert.equal(added, 2);
  assert.equal(systems.length, 3);
  const fnp = systems.find(sys => sys.name === 'FNP');
  assert.equal(fnp.rows.length, 2);
  assert.equal(fnp.prioAdded, 1);
  assert.equal(fnp.rows[1][2], 'REF-NEW-1');
  const opp = systems.find(sys => sys.name === 'OPP');
  assert.equal(opp.rows.length, 1);
  assert.equal(opp._fromPrio, true);
  assert.equal(opp.rows[0][2], 'REF-OPP-1');
  assert.deepEqual(plain(systems.map(sys => sys.name)), ['FNP', 'KSP', 'OPP']);

  const cleared = s.clearPrioFromSystems(systems);
  assert.equal(cleared.length, 2);
  assert.deepEqual(plain(cleared.map(sys => sys.name)), ['FNP', 'KSP']);
  assert.equal(cleared.find(sys => sys.name === 'FNP').rows.length, 1);
});

test('partitionByStep: factual rows split out per Step description; everything else stays tariff', () => {
  const H = ['Vendor details', 'Step description', 'Document number'];
  const rows = [
    ['DHL', 'Tariff Check', 'D1'],        // real-world tariff value
    ['Kuehne', 'Factual Check', 'D2'],    // real-world factual value
    ['Schenker', 'faktuale Prüfung', 'D3'], // German spelling, case-insensitive
    ['Dachser', 'other step', 'D4'],      // unknown step -> tariff
    ['Gebr. Weiss', '', 'D5'],            // blank step -> tariff
  ];
  const p = s.partitionByStep(H, rows);
  assert.deepEqual(plain(p.tariff).map(r => r[0]), ['DHL', 'Dachser', 'Gebr. Weiss']);
  assert.deepEqual(plain(p.factual).map(r => r[0]), ['Kuehne', 'Schenker']);
  // no Step description column -> everything tariff (pre-branching behavior)
  const q = s.partitionByStep(['Vendor details'], [['DHL'], ['Kuehne']]);
  assert.equal(q.tariff.length, 2);
  assert.equal(q.factual.length, 0);
});

test('splitRows: tariff rows pass forwarder+note filters; factual rows bypass both', () => {
  const rows = [
    ['DHL', 'S', 'R', 'D1', []],
    ['Kuehne', 'S', 'R', 'D2', ['bad note']],
  ];
  const fwd = [{ name: 'DHL', checked: true }, { name: 'Kuehne', checked: false }];
  const keep = new Set(); // no notes checked
  assert.deepEqual(plain(s.splitRows({ group: 'tariff', rows, forwarders: fwd }, keep, true)),
    [['DHL', 'S', 'R', 'D1', []]]);            // Kuehne: unchecked forwarder AND unchecked note
  assert.deepEqual(plain(s.splitRows({ rows, forwarders: fwd }, keep, true)),
    [['DHL', 'S', 'R', 'D1', []]]);            // no group -> tariff behavior
  assert.deepEqual(plain(s.splitRows({ group: 'factual', rows, forwarders: fwd }, keep, true)),
    plain(rows));                              // factual ignores forwarders and notes
});

test('parseKreditors: splits on newline/comma/semicolon/space, drops blanks', () => {
  assert.deepEqual([...s.parseKreditors('111\n222, 333;444  555')].sort(),
    ['111', '222', '333', '444', '555']);
  assert.equal(s.parseKreditors('').size, 0);
  assert.equal(s.parseKreditors(undefined).size, 0);
});

test('splitRows: Kreditor exclusion drops Supplier matches in every group', () => {
  const rows = [
    ['DHL', '111', 'R', 'D1', []],
    ['DHL', '222', 'R', 'D2', []],
  ];
  const fwd = [{ name: 'DHL', checked: true }];
  const excl = s.parseKreditors('111, 999');
  assert.deepEqual(plain(s.splitRows({ group: 'tariff', rows, forwarders: fwd }, new Set(), true, excl)),
    [['DHL', '222', 'R', 'D2', []]]);
  assert.deepEqual(plain(s.splitRows({ group: 'factual', rows }, new Set(), true, excl)),
    [['DHL', '222', 'R', 'D2', []]]);  // factual bypasses filters, but not the exclusion
  // numeric Supplier cells match via normDoc
  assert.deepEqual(plain(s.splitRows({ group: 'factual', rows: [['V', 111, 'R', 'D', []]] }, new Set(), true, excl)), []);
  // no exclusion arg -> unchanged (pre-feature behavior)
  assert.equal(s.splitRows({ group: 'factual', rows }, new Set(), true).length, 2);
});

test('parseReferenz: splits on newline/comma/semicolon/space, lowercases, drops blanks', () => {
  assert.deepEqual([...s.parseReferenz('REF-1\nRef-2, ref-3;REF-4  ref-5')].sort(),
    ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5']);
  assert.equal(s.parseReferenz('').size, 0);
  assert.equal(s.parseReferenz(undefined).size, 0);
});

test('splitRows: Referenz exclusion drops Reference matches (case-insensitive) in every group', () => {
  const rows = [
    ['DHL', '111', 'REF-ABC', 'D1', []],
    ['DHL', '222', 'REF-XYZ', 'D2', []],
    ['DHL', '333', '12345',   'D3', []],
  ];
  const fwd = [{ name: 'DHL', checked: true }];
  const excl = s.parseReferenz('ref-abc, 12345');
  // Tariff group
  assert.deepEqual(plain(s.splitRows({ group: 'tariff', rows, forwarders: fwd }, new Set(), true, null, excl)),
    [['DHL', '222', 'REF-XYZ', 'D2', []]]);
  // Factual group
  assert.deepEqual(plain(s.splitRows({ group: 'factual', rows }, new Set(), true, null, excl)),
    [['DHL', '222', 'REF-XYZ', 'D2', []]]);
  // Both Kreditor and Referenz exclusions combined
  const kredExcl = s.parseKreditors('222');
  assert.deepEqual(plain(s.splitRows({ group: 'tariff', rows, forwarders: fwd }, new Set(), true, kredExcl, excl)),
    []);
  // Numeric Reference cells match via normDoc
  assert.deepEqual(plain(s.splitRows({ group: 'factual', rows: [['V', 'S', 12345, 'D', []]] }, new Set(), true, null, excl)),
    []);
});

test('workbookEntries: multi-sheet workbook — one system per qualifying sheet, named by sheet name', () => {
  const H = ['Vendor details', 'Supplier', 'Reference', 'Document number', 'Step description'];
  const sheets = [
    { name: ' FNP ', rows: [H, ['DHL', 'S', 'R', 'D1', 'Tariff Check'], ['Kuehne', 'S', 'R', 'D2', 'Factual Check']] },
    { name: 'KSP', rows: [H, ['Schenker', 'S', 'R', 'D3', 'Tariff Check']] },
    { name: 'Pivot', rows: [['some', 'junk']] }, // no target columns -> skipped
  ];
  const res = s.workbookEntries(sheets, 'export_2026-07-07.xlsx');
  assert.deepEqual(plain(res.entries.map(e => [e.base, e.group, e.rows.length])), [
    ['FNP', 'tariff', 1], ['FNP', 'factual', 1], // mixed sheet -> two entries, sheet name trimmed
    ['KSP', 'tariff', 1],
  ]);
});

test('workbookEntries: single qualifying sheet keeps filename naming (one-file-per-system upload)', () => {
  const H = ['Vendor details', 'Supplier', 'Reference', 'Document number'];
  const res = s.workbookEntries([{ name: 'Sheet1', rows: [[], H, ['DHL', 'S', 'R', 'D1']] }], 'FNP.XLSX');
  assert.deepEqual(plain(res.entries.map(e => [e.base, e.group, e.rows.length])), [['FNP', 'tariff', 1]]);
});

test('workbookEntries: no qualifying sheet -> error; empty qualifying sheet -> 0-row tariff card', () => {
  assert.match(s.workbookEntries([{ name: 'S1', rows: [['Vendor details', 'Supplier', 'Reference']] }], 'x.xlsx').error,
    /Missing column: Document number/);
  assert.match(s.workbookEntries([{ name: 'A', rows: [['a']] }, { name: 'B', rows: [['b']] }], 'x.xlsx').error,
    /No sheet/);
  const H = ['Vendor details', 'Supplier', 'Reference', 'Document number'];
  const res = s.workbookEntries([{ name: 'FNP', rows: [H] }, { name: 'KSP', rows: [H, ['DHL', 'S', 'R', 'D']] }], 'x.xlsx');
  assert.deepEqual(plain(res.entries.map(e => [e.base, e.group, e.rows.length])),
    [['FNP', 'tariff', 0], ['KSP', 'tariff', 1]]);
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

test('prioByDate: PRIO when today − overdue ≥ −5 days, nearest-day rounding', () => {
  const today = new Date(2026, 6, 9, 10, 30); // 2026-07-09 local, mid-morning
  const d = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 6, day, hh, mm, ss);
  assert.equal(s.prioByDate(d(15), today), false); // diff −6 -> not yet
  assert.equal(s.prioByDate(d(14), today), true);  // diff −5 boundary -> PRIO
  assert.equal(s.prioByDate(d(9), today), true);   // diff 0, due today -> PRIO
  assert.equal(s.prioByDate(d(6), today), true);   // diff +3, already overdue -> PRIO
  // SheetJS quirk: serial date lands 23:59:48 the day before -> must count as next day
  assert.equal(s.prioByDate(d(12, 23, 59, 48), today), true);  // is really 7/13, diff −4
  assert.equal(s.prioByDate(d(14, 23, 59, 48), today), false); // is really 7/15, diff −6
  // non-dates never mark
  assert.equal(s.prioByDate('', today), false);
  assert.equal(s.prioByDate('garbage', today), false);
  assert.equal(s.prioByDate(undefined, today), false);
  // parseable string dates work
  assert.equal(s.prioByDate('2026-07-06T12:00:00', today), true); // diff +3
});

test('fmtOverdue: signed day diff vs today (+ = overdue), weekend rolls to Friday first', () => {
  const today = new Date(2026, 6, 9); // Thursday 2026-07-09
  assert.equal(s.fmtOverdue(new Date(2026, 6, 13), today), '-4'); // Monday, due in 4 days
  assert.equal(s.fmtOverdue(new Date(2026, 6, 6), today), '+3');  // 3 days overdue
  assert.equal(s.fmtOverdue(new Date(2026, 6, 9), today), '0');   // due today
  // weekend rolls back to the previous Friday before the diff
  assert.equal(s.fmtOverdue(new Date(2026, 6, 11), today), '-1'); // Sat -> Fri 10.07
  assert.equal(s.fmtOverdue(new Date(2026, 6, 12), today), '-1'); // Sun -> Fri 10.07
  // SheetJS quirk: serial lands 23:59:48 the day before -> rounds to next day
  assert.equal(s.fmtOverdue(new Date(2026, 6, 12, 23, 59, 48), today), '-4'); // is really Mon 7/13
  assert.equal(s.fmtOverdue('2026-07-06T09:00:00', today), '+3'); // parseable string
  assert.equal(s.fmtOverdue('', today), '');
  assert.equal(s.fmtOverdue(undefined, today), '');
  assert.equal(s.fmtOverdue('garbage', today), 'garbage');
});

test('isPrio: PRIO-list doc match OR overdue date within window', () => {
  const today = new Date(2026, 6, 9);
  const row = (doc, overdue) => ['V', 'S', 'R', doc, [], overdue];
  const docs = new Set(['D1']);
  assert.equal(s.isPrio(row('D1', ''), docs, today), true);                        // list match alone
  assert.equal(s.isPrio(row('D2', ''), docs, today), false);                       // neither trigger
  assert.equal(s.isPrio(row('D2', new Date(2026, 6, 6)), docs, today), true);      // date rule alone (+3 overdue)
  assert.equal(s.isPrio(row('D2', new Date(2026, 6, 13)), null, today), true);     // no list, diff −4 -> PRIO
  assert.equal(s.isPrio(row('D2', new Date(2026, 6, 20)), null, today), false);    // no list, diff −11 -> no
  assert.equal(s.isPrio(row(' D1 ', ''), docs, today), true);                      // doc normalized via normDoc
});

test('sliceBounds: contiguous balanced [start,end) bands covering all n rows', () => {
  assert.deepEqual(plain(s.sliceBounds(5, [1, 1, 1, 1])), [[0, 2], [2, 3], [3, 4], [4, 5]]);
  assert.deepEqual(plain(s.sliceBounds(0, [1, 1])), [[0, 0], [0, 0]]);
  const b = s.sliceBounds(79, [1, 1, 1]);
  assert.equal(b[0][0], 0);
  assert.equal(b[b.length - 1][1], 79);                                  // covers everything
  for (let i = 1; i < b.length; i++) assert.equal(b[i][0], b[i - 1][1]); // no gaps, no overlap
});

test('snapBoundsToDocRuns: interior cuts move off equal-doc runs to the nearer edge', () => {
  const r = d => ['V', 'S', 'R', d, []];
  const rows = [r('9'), r('9'), r('9'), r('8'), r('7')];         // doc-sorted Z→A
  assert.deepEqual(plain(s.snapBoundsToDocRuns([[0, 2], [2, 4], [4, 5]], rows)),
    [[0, 3], [3, 4], [4, 5]]);                                   // cut 2 inside the 9-run -> nudged to 3
  const oneDoc = [r('5'), r('5'), r('5'), r('5'), r('1')];
  assert.deepEqual(plain(s.snapBoundsToDocRuns([[0, 2], [2, 4], [4, 5]], oneDoc)),
    [[0, 4], [4, 4], [4, 5]]);                                   // run swallows a band -> band empty, run intact
  const blanks = [r('9'), r(''), r(''), r('')];
  assert.deepEqual(plain(s.snapBoundsToDocRuns([[0, 2], [2, 4]], blanks)),
    [[0, 2], [2, 4]]);                                           // blank docs are unrelated -> may still split
  assert.deepEqual(plain(s.snapBoundsToDocRuns([[0, 3]], rows)), [[0, 3]]); // single band untouched
});

test('systemShares: PRIO rows split evenly (±1) across shares, all rows covered once', () => {
  // 5 PRIO + 7 rest rows -> 3 shares
  const row = (doc, isP) => ['V', 'S', 'R', doc, [], isP ? new Date(2026, 6, 6) : ''];
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row('P' + i, true));
  for (let i = 0; i < 7; i++) rows.push(row('R' + i, false));
  const isPrioRow = r => !!r[5];
  for (const doShuffle of [false, true]) {
    const shares = s.systemShares(rows, [1, 1, 1], doShuffle, isPrioRow);
    assert.equal(shares.length, 3);
    const prioCounts = shares.map(sh => sh.filter(isPrioRow).length);
    assert.equal(Math.max(...prioCounts) - Math.min(...prioCounts) <= 1, true,
      `prio counts ±1, got ${prioCounts} (shuffle=${doShuffle})`);
    assert.equal(prioCounts.reduce((a, b) => a + b, 0), 5);
    // every input row appears exactly once across all shares
    const docs = shares.flat().map(r => r[3]).sort();
    assert.deepEqual(plain(docs), plain(rows.map(r => r[3]).sort()));
  }
});

test('systemShares: zero PRIO rows + shuffle off -> plain in-order single-pool split', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  const rows = [row('5'), row('4'), row('3'), row('2'), row('1')];
  const shares = s.systemShares(rows, [1, 1], false, () => false);
  // remainder to the front, original order preserved — today's no-shuffle behavior
  assert.deepEqual(plain(shares.map(sh => sh.map(r => r[3]))), [['5', '4', '3'], ['2', '1']]);
});

test('systemShares: doc runs stay intact within a pool when shuffled', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  // doc-sorted pool ['9','9','9','8']: naive cut at 2 lands inside the 9-run
  const rows = [row('9'), row('9'), row('9'), row('8')];
  const shares = s.systemShares(rows, [1, 1], true, () => false);
  const withNine = shares.filter(sh => sh.some(r => r[3] === '9'));
  assert.equal(withNine.length, 1);                              // all '9' rows in one share
  assert.equal(withNine[0].filter(r => r[3] === '9').length, 3); // none lost
});

test('systemShares: more shares than rows -> empty shares, nothing lost', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  const shares = s.systemShares([row('1')], [1, 1, 1], false, () => false);
  assert.deepEqual(plain(shares.map(sh => sh.length)), [1, 0, 0]);
});

test('splitRows: end-to-end exclusion with Kreditor, Referenz, and PRIO rows', () => {
  const normalRows = [
    ['DHL', 'K10', 'REF-001', 'D101', []],
    ['DHL', 'K20', 'REF-002', 'D102', []],
    ['DHL', 'K30', 'REF-003', 'D103', []],
  ];
  const prioRows = [
    ['DHL', 'K10', 'REF-004', 'D104', []], // K10 excluded
    ['DHL', 'K40', 'REF-005', 'D105', []], // kept
    ['DHL', 'K50', 'REF-001', 'D106', []], // REF-001 excluded
  ];
  const sys = {
    name: 'FNP',
    group: 'tariff',
    rows: [...normalRows, ...prioRows],
    forwarders: [{ name: 'DHL', checked: true }]
  };
  const kredExcl = s.parseKreditors('K10');
  const refExcl = s.parseReferenz('ref-001');

  const kept = s.splitRows(sys, new Set(), true, kredExcl, refExcl);
  // D101 dropped (ref-001 & K10), D104 dropped (K10), D106 dropped (ref-001)
  assert.deepEqual(plain(kept.map(r => r[3])), ['D102', 'D103', 'D105']);
});

test('systemShares: honours the weight ratio (2:1) in both pools, all rows covered once', () => {
  const row = (doc, isP) => ['V', 'S', 'R', doc, [], isP ? new Date(2026, 6, 6) : ''];
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push(row('P' + i, true));   // 9 PRIO
  for (let i = 0; i < 9; i++) rows.push(row('R' + i, false));  // 9 rest
  const isPrioRow = r => !!r[5];
  for (const doShuffle of [false, true]) {
    const shares = s.systemShares(rows, [1, 0.5], doShuffle, isPrioRow); // full + half
    assert.equal(shares.length, 2);
    // every row covered exactly once
    assert.deepEqual(plain(shares.flat().map(r => r[3]).sort()), plain(rows.map(r => r[3]).sort()));
    // each pool splits 6 full-day + 3 half-day, so the weight-0.5 person
    // (index 1) gets the smaller share in both shuffle states
    assert.equal(shares[1].filter(r => !isPrioRow(r)).length, 3, `main half-day ${shares.map(sh => sh.length)}`);
    assert.equal(shares[1].filter(isPrioRow).length, 3, `prio half-day ${shares.map(sh => sh.length)}`);
    assert.deepEqual(plain(shares.map(sh => sh.length)), [12, 6]);
  }
});

test('systemShares: shuffle keeps the half-day person on the half-size band', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push(row('D' + String(i).padStart(4, '0')));
  const weights = s.weightsForNames(['A', 'B', 'C'], new Set(['C'])); // 1 / 1 / 0.5
  assert.deepEqual(plain(weights), [1, 1, 0.5]);
  for (let k = 0; k < 20; k++) {
    const shares = s.systemShares(rows, weights, true, () => false);
    // bands [120, 120, 60]: only the two equal-length full bands may swap
    assert.equal(shares[2].length, 60, `half-day band on run ${k}: ${shares.map(sh => sh.length)}`);
    assert.equal(shares[0].length + shares[1].length, 240);
    assert.deepEqual(plain(shares.flat().map(r => r[3]).sort()), plain(rows.map(r => r[3]).sort()));
  }
});

test('systemShares: half-day person gets half of the full-day share, PRIO and rest alike', () => {
  const row = (doc, isP) => ['V', 'S', 'R', doc, [], isP ? new Date(2026, 6, 6) : ''];
  const weights = s.weightsForNames(['Ana', 'Ben'], new Set(['Ben'])); // [1, 0.5]
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(row('P' + i, true));
  for (let i = 0; i < 60; i++) rows.push(row('R' + i, false));
  const isPrioRow = r => !!r[5];
  // bands from the weights, and the same bands handed in as a whole-job plan
  for (const poolPlans of [undefined, [[27, 13], [40, 20]]]) {
    const shares = s.systemShares(rows, weights, false, isPrioRow, poolPlans);
    assert.deepEqual(plain(shares.map(sh => sh.length)), [67, 33]);
  }
});

test('whole-job split: totals across systems stay even and half-day stays half', () => {
  const row = (doc, sys) => [`V${sys}`, 'S', 'R', doc, [], ''];
  const systems = [0, 1, 2].map(k => Array.from({ length: 8 }, (_, i) => row('D' + k + i, k)));
  const weights = s.weightsForNames(['A', 'B', 'C', 'D'], new Set(['D']));
  const plan = s.allocateJobShares(systems.map(rows => rows.length), weights);
  for (const doShuffle of [false, true]) {
    const totals = [0, 0, 0, 0];
    systems.forEach((rows, si) => {
      const shares = s.systemShares(rows, weights, doShuffle, () => false, [plan[si].map(() => 0), plan[si]]);
      shares.forEach((sh, i) => { totals[i] += sh.length; });
    });
    assert.deepEqual(totals, [7, 7, 7, 3], `doShuffle=${doShuffle}`);
  }
});

test('whole-job split: all-full teams stay even across systems too', () => {
  const row = (doc, sys) => [`V${sys}`, 'S', 'R', doc, [], ''];
  const systems = [0, 1, 2].map(k => Array.from({ length: 8 }, (_, i) => row('D' + k + i, k)));
  const weights = s.weightsForNames(['A', 'B', 'C'], new Set());
  const plan = s.allocateJobShares(systems.map(rows => rows.length), weights);
  const totals = [0, 0, 0];
  systems.forEach((rows, si) => {
    const shares = s.systemShares(rows, weights, false, () => false, [plan[si].map(() => 0), plan[si]]);
    shares.forEach((sh, i) => { totals[i] += sh.length; });
  });
  assert.deepEqual(totals, [8, 8, 8]);   // per-system rounding alone gives 9/9/6
});

test('whole-job split: each system PRIO pool shares the person\'s planned count', () => {
  const row = (doc, sys, isP) => [`V${sys}`, 'S', 'R', doc, [], isP ? new Date(2026, 6, 6) : ''];
  const systems = [{ prio: 6, rest: 10 }, { prio: 4, rest: 6 }, { prio: 2, rest: 4 }].map((c, k) => {
    const rows = [];
    for (let i = 0; i < c.prio; i++) rows.push(row('P' + k + i, k, true));
    for (let i = 0; i < c.rest; i++) rows.push(row('R' + k + i, k, false));
    return rows;
  });
  const weights = s.weightsForNames(['A', 'B', 'C', 'D'], new Set(['D']));
  const isPrioRow = r => !!r[5];
  const plan = s.allocateJobShares(systems.map(rows => rows.length), weights);
  for (const doShuffle of [false, true]) {
    const totals = [0, 0, 0, 0], prioTotals = [0, 0, 0, 0];
    systems.forEach((rows, si) => {
      const nPrio = rows.filter(isPrioRow).length;
      const prioSizes = nPrio > 0 ? s.balancedSizes(nPrio, plan[si]) : plan[si].map(() => 0);
      const restSizes = plan[si].map((sz, i) => sz - prioSizes[i]);
      const shares = s.systemShares(rows, weights, doShuffle, isPrioRow, [prioSizes, restSizes]);
      shares.forEach((sh, i) => { totals[i] += sh.length; prioTotals[i] += sh.filter(isPrioRow).length; });
    });
    assert.deepEqual(totals, [9, 9, 9, 5], `doShuffle=${doShuffle}`);
    assert.deepEqual(prioTotals, [3, 4, 3, 2], `prio doShuffle=${doShuffle}`);
  }
});

test('systemShares: more shares than rows (weights) -> empty shares, nothing lost', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  const shares = s.systemShares([row('1')], [1, 0.5], false, () => false);
  assert.deepEqual(plain(shares.map(sh => sh.length)), [1, 0]); // full takes all, half gets 0
});

test('upload guard: dropzone and PRIO uploads keep their own bad-type message (plural vs singular)', () => {
  const fresh = loadSplitter(); // own sandbox so the showError override cannot leak
  const seen = [];
  fresh.showError = msg => seen.push(msg);
  fresh.handleFile({ name: 'notes.txt' });
  fresh.handlePrioFile({ name: 'notes.txt' });
  assert.deepEqual(seen, [
    'Please upload Excel files (.xlsx or .xls).',
    'Please upload an Excel file (.xlsx or .xls).',
  ]);
});

test('savedForwarderState: an unseen system and an unseen forwarder default to checked', () => {
  const t = loadSplitter(); // own store: these tests write forwarder state
  assert.equal(t.savedForwarderState('FNP', 'DHL'), true);    // fresh store, nothing saved
  t.saveForwarderState('FNP', 'DHL', false);                  // FNP is now a known system
  assert.equal(t.savedForwarderState('FNP', 'Kuehne'), true); // unseen forwarder in a known system
});

test('saveForwarderState: false round-trips and lands under fileSplitter.forwarders as an object', () => {
  const t = loadSplitter();
  t.saveForwarderState('FNP', 'DHL', false);
  assert.equal(t.savedForwarderState('FNP', 'DHL'), false);
  assert.deepEqual(plain(JSON.parse(t.localStorage.getItem(FORWARDER_KEY))), { FNP: { DHL: false } });
});

test('saveForwarderState: state is per system - the same vendor in another system stays checked', () => {
  const t = loadSplitter();
  t.saveForwarderState('FNP', 'DHL', false);
  assert.equal(t.savedForwarderState('FNP', 'DHL'), false); // sanity: the save landed
  assert.equal(t.savedForwarderState('KSP', 'DHL'), true);  // other system, same vendor name
});

test('refreshSystemForwarders: seeds each vendor from saved state, unseen vendors stay checked', () => {
  const t = loadSplitter();
  t.saveForwarderState('FNP', 'DHL', false);
  const sys = {
    name: 'FNP', forwarders: [],
    rows: [['DHL', 's', 'r', 'd', [], ''], ['Kuehne', 's', 'r', 'd', [], '']],
  };
  t.refreshSystemForwarders(sys);
  assert.deepEqual(plain(sys.forwarders), [
    { name: 'DHL', count: 1, checked: false },
    { name: 'Kuehne', count: 1, checked: true },
  ]);
});

test('refreshSystemForwarders: an in-session toggle outranks the saved value', () => {
  const t = loadSplitter();
  t.saveForwarderState('FNP', 'DHL', false);                  // saved: DHL unchecked
  const sys = {
    name: 'FNP',
    forwarders: [{ name: 'DHL', count: 1, checked: true }],   // but re-checked this session
    rows: [['DHL', 's', 'r', 'd', [], ''], ['Kuehne', 's', 'r', 'd', [], '']],
  };
  t.refreshSystemForwarders(sys);
  assert.equal(sys.forwarders.find(f => f.name === 'DHL').checked, true);
  assert.equal(sys.forwarders.find(f => f.name === 'Kuehne').checked, true);
});

test('forwarder persistence: a corrupted store is replaced, and __proto__ does not pollute', () => {
  for (const bad of ['5', '[1,2]']) {
    const t = loadSplitter({ seed: { [FORWARDER_KEY]: bad } });
    assert.doesNotThrow(() => t.saveForwarderState('SYS', 'DHL', false), `seed ${bad}`);
    const stored = JSON.parse(t.localStorage.getItem(FORWARDER_KEY));
    assert.equal(Array.isArray(stored), false, `stored value must stay an object after seed ${bad}`);
    assert.deepEqual(plain(stored), { SYS: { DHL: false } }, `stored value after seed ${bad}`);
  }
  // A system literally named __proto__ must not write through to Object.prototype.
  // savedForwarderState is a vm-realm function, so its .constructor is that realm's
  // Function: it hands back the vm Object.prototype for an honest in-realm check.
  const t = loadSplitter();
  const vmProto = t.savedForwarderState.constructor('return Object.prototype')();
  assert.equal(vmProto.DHL, undefined);
  t.saveForwarderState('__proto__', 'DHL', false);
  assert.equal(t.savedForwarderState('__proto__', 'DHL'), false);
  assert.equal(vmProto.DHL, undefined);
  assert.equal(Object.prototype.DHL, undefined); // host realm stays clean too
});

test('forwarder persistence: a well-formed stored value is read back on load', () => {
  const t = loadSplitter({ seed: { [FORWARDER_KEY]: '{"FNP":{"DHL":false,"Kuehne":true}}' } });
  assert.equal(t.savedForwarderState('FNP', 'DHL'), false);  // saved pick survives the load
  assert.equal(t.savedForwarderState('FNP', 'Kuehne'), true);
  assert.equal(t.savedForwarderState('KSP', 'DHL'), true);   // still per system
});

test('reconcilePrio: a remembered Reference keeps the PRIO row out, a fresh one is still added', () => {
  const entries = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] }];
  const t = loadSplitter({ seed: { [LAST_OUTPUT_KEY]: '{"FNP|tariff":{"refs":["REF-1"],"docs":[]}}' } });
  const systems = [{ name: 'FNP', group: 'tariff', rows: [] }];
  assert.equal(t.reconcilePrio(systems, entries), 0);        // default seen = loaded lastOutput
  assert.equal(systems[0].prioAdded, 0);
  assert.equal(systems[0].rows.length, 0);

  const t2 = loadSplitter();                                 // no memory -> row is added
  const systems2 = [{ name: 'FNP', group: 'tariff', rows: [] }];
  assert.equal(t2.reconcilePrio(systems2, entries), 1);
  assert.equal(systems2[0].prioAdded, 1);
  assert.equal(systems2[0].rows[0][2], 'REF-1');
});

test('reconcilePrio: a remembered Document number also keeps the PRIO row out', () => {
  const t = loadSplitter();
  const systems = [{ name: 'FNP', group: 'tariff', rows: [] }];
  const entries = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] }];
  const seen = new Map([['FNP|tariff', { refs: new Set(), docs: new Set(['D1']) }]]);
  assert.equal(t.reconcilePrio(systems, entries, true, seen), 0);
  assert.equal(systems[0].prioAdded, 0);
});

test('reconcilePrio: a PRIO row absent from the remembered set is still added', () => {
  const t = loadSplitter();
  const systems = [{ name: 'FNP', group: 'tariff', rows: [] }];
  const entries = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-NEW', 'D9', [], ''] }];
  const seen = new Map([['FNP|tariff', { refs: new Set(['REF-OTHER']), docs: new Set(['D8']) }]]);
  assert.equal(t.reconcilePrio(systems, entries, true, seen), 1);
  assert.equal(systems[0].prioAdded, 1);
  assert.equal(systems[0].rows[0][2], 'REF-NEW');
});

test('reconcilePrio: a PRIO-only system is not recreated when its only row is remembered', () => {
  const t = loadSplitter();
  const seen = new Map([['OPP|tariff', { refs: new Set(['REF-OPP']), docs: new Set() }]]);
  const entries = [{ system: 'OPP', group: 'tariff', row: ['Kuehne', 'K3', 'REF-OPP', 'D20', [], ''] }];
  const systems = [];
  assert.equal(t.reconcilePrio(systems, entries, true, seen), 0);
  assert.equal(systems.length, 0);                            // no system created from an already-output row

  const fresh = [{ system: 'OPP', group: 'tariff', row: ['Kuehne', 'K4', 'REF-NEW', 'D21', [], ''] }];
  const systems2 = [];
  assert.equal(t.reconcilePrio(systems2, fresh, true, seen), 1);
  assert.equal(systems2.length, 1);
  assert.equal(systems2[0].rows.length, 1);
  assert.equal(systems2[0]._fromPrio, true);
});

test('reconcilePrio: a Reference remembered for FNP does not suppress the same Reference in KSP', () => {
  const t = loadSplitter();
  const seen = new Map([['FNP|tariff', { refs: new Set(['REF-1']), docs: new Set() }]]);
  const ksp = [{ name: 'KSP', group: 'tariff', rows: [] }];
  const kspEntry = [{ system: 'KSP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] }];
  assert.equal(t.reconcilePrio(ksp, kspEntry, true, seen), 1); // FNP memory does not reach KSP
  assert.equal(ksp[0].rows.length, 1);

  const fnp = [{ name: 'FNP', group: 'tariff', rows: [] }];     // control: same ref does suppress FNP
  const fnpEntry = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] }];
  assert.equal(t.reconcilePrio(fnp, fnpEntry, true, seen), 0);
  assert.equal(fnp[0].rows.length, 0);
});

test('reconcilePrio: an unknown system renamed between runs still matches via a shared name token', () => {
  const t = loadSplitter();
  t.rememberOutput([{ name: 'DHL EXPORT 2026-10-13', group: 'tariff', rows: [['DHL', 'K1', 'REF-X', 'D-X', [], '']] }]);
  const systems = [{ name: 'DHL EXPORT 2026-10-14', group: 'tariff', rows: [] }];
  const entries = [
    { system: 'DHL', group: 'tariff', row: ['DHL', 'K1', 'REF-X', 'D-X', [], ''] },      // remembered -> skipped
    { system: 'DHL', group: 'tariff', row: ['DHL', 'K2', 'REF-NEW', 'D-NEW', [], ''] },  // fresh -> added
  ];
  assert.equal(t.reconcilePrio(systems, entries), 1);
  assert.equal(systems[0].rows.length, 1);
  assert.equal(systems[0].rows[0][2], 'REF-NEW');
});

test('reconcilePrio: an unknown PRIO token matches the uploaded unknown system name', () => {
  const t = loadSplitter();
  t.rememberOutput([{ name: 'DHL FREIGHT', group: 'tariff', rows: [['DHL', 'K1', 'REF-X', 'D-X', [], '']] }]);
  const systems = [{ name: 'DHL FREIGHT', group: 'tariff', rows: [] }];
  const entries = [
    { system: 'DHL', group: 'tariff', row: ['DHL', 'K1', 'REF-X', 'D-X', [], ''] },      // token DHL, remembered -> skipped
    { system: 'DHL', group: 'tariff', row: ['DHL', 'K2', 'REF-NEW', 'D-NEW', [], ''] },  // fresh -> added
  ];
  assert.equal(t.reconcilePrio(systems, entries), 1);
  assert.equal(systems[0].rows.length, 1);
  assert.equal(systems[0].rows[0][2], 'REF-NEW');

  const t2 = loadSplitter();
  t2.rememberOutput([{ name: 'DHL FREIGHT', group: 'tariff', rows: [['DHL', 'K1', 'REF-X', 'D-X', [], '']] }]);
  const none = [];
  assert.equal(t2.reconcilePrio(none, entries), 1);          // no uploaded system: remembered row not revived, fresh one creates the system
  assert.equal(none.length, 1);
  assert.equal(none[0].rows.length, 1);
  assert.equal(none[0].rows[0][2], 'REF-NEW');
});

test('reconcilePrio: a legacy ad-hoc bucket never suppresses a known system', () => {
  const t = loadSplitter();
  // The previous key format filed every unknown name under 'OTHER'; such an
  // entry must not suppress a known system whose PRIO token is an unknown
  // substring (the removed p-token lookup did exactly that).
  const seen = new Map([['OTHER|tariff', { refs: new Set(['REF-X']), docs: new Set() }]]);
  const systems = [{ name: 'OPP', group: 'tariff', rows: [] }];
  const entries = [
    { system: 'OP', group: 'tariff', row: ['Kuehne', 'K3', 'REF-X', 'D20', [], ''] },    // same ref, must be added
    { system: 'OP', group: 'tariff', row: ['Kuehne', 'K4', 'REF-NEW', 'D21', [], ''] },  // fresh control -> added
  ];
  assert.equal(t.reconcilePrio(systems, entries, true, seen), 2);
  assert.equal(systems[0].rows.length, 2);
  assert.equal(systems[0].prioAdded, 2);
});

test('reconcilePrio: unrelated ad-hoc systems do not collide on a shared Reference', () => {
  const remembered = [{ name: 'Alpha Logistics', group: 'tariff', rows: [['Alpha', 'K1', 'REF-1', 'D1', [], '']] }];
  // Alpha's ref must not suppress the same ref from an unrelated Beta Freight.
  const t = loadSplitter();
  t.rememberOutput(remembered);
  const systems = [{ name: 'Beta Freight', group: 'tariff', rows: [] }];
  const collide = [{ system: 'Beta Freight', group: 'tariff', row: ['Beta', 'K1', 'REF-1', 'D1', [], ''] }];
  assert.equal(t.reconcilePrio(systems, collide), 1);
  assert.equal(systems[0].rows.length, 1);
  // Fresh ref control: still one row added.
  const t2 = loadSplitter();
  t2.rememberOutput(remembered);
  const systems2 = [{ name: 'Beta Freight', group: 'tariff', rows: [] }];
  const fresh = [{ system: 'Beta Freight', group: 'tariff', row: ['Beta', 'K2', 'REF-2', 'D2', [], ''] }];
  assert.equal(t2.reconcilePrio(systems2, fresh), 1);
  assert.equal(systems2[0].rows.length, 1);
  // PRIO-only Gamma Freight: Alpha's ref must not stop the new system.
  const t3 = loadSplitter();
  t3.rememberOutput(remembered);
  const none = [];
  const prioOnly = [
    { system: 'Gamma Freight', group: 'tariff', row: ['Gamma', 'K1', 'REF-1', 'D1', [], ''] }, // same ref, unrelated name
    { system: 'Gamma Freight', group: 'tariff', row: ['Gamma', 'K2', 'REF-2', 'D2', [], ''] }, // fresh -> creates the system
  ];
  assert.equal(t3.reconcilePrio(none, prioOnly), 2);
  assert.equal(none.length, 1);
  assert.equal(none[0].rows.length, 2);
});

test('lastOutput: absent, corrupt, and legacy storage load as empty without throwing', () => {
  const legacy = '{"refs":["REF-1"],"docs":[]}';           // pre-per-system shape
  for (const raw of [undefined, 'not json', '[1,2]', '{"refs":5,"docs":"x"}', '{"FNP|tariff":{"refs":5}}', legacy]) {
    const t = raw === undefined ? loadSplitter() : loadSplitter({ seed: { [LAST_OUTPUT_KEY]: raw } });
    const systems = [{ name: 'FNP', group: 'tariff', rows: [] }];
    const entries = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] }];
    assert.doesNotThrow(() => t.reconcilePrio(systems, entries), `raw=${raw}`);
    assert.equal(systems[0].rows.length, 1, `raw=${raw}`);   // empty memory -> row still added
  }
});

test('rememberOutput: persists normalized refs and docs per system and feeds the next reconcile', () => {
  const t = loadSplitter();
  t.rememberOutput([{ name: 'FNP', group: 'tariff', rows: [['DHL', 'K1', ' REF-1 ', ' D1 ', [], ''], ['DHL', 'K2', '', 'D2', [], '']] }]);
  const stored = plain(JSON.parse(t.localStorage.getItem(LAST_OUTPUT_KEY)));
  assert.deepEqual(stored['FNP|tariff'].refs, ['REF-1']);   // trimmed; blank Reference dropped
  assert.deepEqual(stored['FNP|tariff'].docs, ['D1', 'D2']);
  const systems = [{ name: 'FNP', group: 'tariff', rows: [] }];
  const entries = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] }];
  assert.equal(t.reconcilePrio(systems, entries), 0);       // in-memory set updated too
});

test('rememberOutput: each run replaces the memory instead of growing it', () => {
  const t = loadSplitter();
  t.rememberOutput([{ name: 'FNP', group: 'tariff', rows: [['DHL', 'K1', 'REF-OLD', 'D-OLD', [], '']] }]);
  t.rememberOutput([{ name: 'FNP', group: 'tariff', rows: [['DHL', 'K2', 'REF-NEW', 'D-NEW', [], '']] }]);
  const systems = [{ name: 'FNP', group: 'tariff', rows: [] }];
  const entries = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-OLD', 'D-OLD', [], ''] }];
  assert.equal(t.reconcilePrio(systems, entries), 1);       // the previous run is forgotten
});

test('clearLastOutput: forgets the rows and clears the stored key', () => {
  const t = loadSplitter();
  t.rememberOutput([{ name: 'FNP', group: 'tariff', rows: [['DHL', 'K1', 'REF-1', 'D1', [], '']] }]);
  t.clearLastOutput();
  assert.equal(t.localStorage.getItem(LAST_OUTPUT_KEY), null);
  const systems = [{ name: 'FNP', group: 'tariff', rows: [] }];
  const entries = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] }];
  assert.equal(t.reconcilePrio(systems, entries), 1);
});

test('reconcilePrio: an unknown name with no significant tokens still matches itself exactly', () => {
  for (const name of ['OP', 'GRÜN']) {
    const t = loadSplitter();
    t.rememberOutput([{ name, group: 'tariff', rows: [['D', 'K', 'REF-A', 'D-A', [], '']] }]);
    const systems = [{ name, group: 'tariff', rows: [] }];
    const same = [{ system: name, group: 'tariff', row: ['D', 'K', 'REF-A', 'D-A', [], ''] }];
    assert.equal(t.reconcilePrio(systems, same), 0, `${name}: own remembered row is suppressed`);
    assert.equal(systems[0].rows.length, 0, name);
    const fresh = [{ system: name, group: 'tariff', row: ['D', 'K', 'REF-B', 'D-B', [], ''] }];
    assert.equal(t.reconcilePrio(systems, fresh), 1, `${name}: fresh reference is added`);
    assert.equal(systems[0].rows[0][2], 'REF-B', name);
  }
});

test('reconcilePrio: a token subset still follows a rename, and a one-token PRIO name matches the full remembered name', () => {
  // Equal token sets: a date-only rename keeps the memory.
  const t = loadSplitter();
  t.rememberOutput([{ name: 'DHL EXPORT 2026-10-13', group: 'tariff', rows: [['DHL', 'K1', 'REF-X', 'D-X', [], '']] }]);
  const systems = [{ name: 'DHL EXPORT 2026-10-14', group: 'tariff', rows: [] }];
  const same = [{ system: 'DHL', group: 'tariff', row: ['DHL', 'K1', 'REF-X', 'D-X', [], ''] }];
  assert.equal(t.reconcilePrio(systems, same), 0);
  assert.equal(systems[0].rows.length, 0);

  // PRIO token is a subset of the remembered name; missing branch.
  const t2 = loadSplitter();
  t2.rememberOutput([{ name: 'DHL FREIGHT', group: 'tariff', rows: [['DHL', 'K1', 'REF-X', 'D-X', [], '']] }]);
  const none = [];
  const entries = [
    { system: 'DHL', group: 'tariff', row: ['DHL', 'K1', 'REF-X', 'D-X', [], ''] },      // remembered -> skipped
    { system: 'DHL', group: 'tariff', row: ['DHL', 'K2', 'REF-NEW', 'D-NEW', [], ''] },  // fresh -> added
  ];
  assert.equal(t2.reconcilePrio(none, entries), 1);
  assert.equal(none.length, 1);
  assert.equal(none[0].rows[0][2], 'REF-NEW');
});

test('reconcilePrio: a generic shared token does not merge two different ad-hoc names', () => {
  // Existing branch: remembered DHL EXPRESS, uploaded DHL FREIGHT, PRIO token DHL.
  const t = loadSplitter();
  t.rememberOutput([{ name: 'DHL EXPRESS', group: 'tariff', rows: [['DHL', 'K1', 'REF-X', 'D-X', [], '']] }]);
  const systems = [{ name: 'DHL FREIGHT', group: 'tariff', rows: [] }];
  const same = [{ system: 'DHL', group: 'tariff', row: ['DHL', 'K1', 'REF-X', 'D-X', [], ''] }];
  assert.equal(t.reconcilePrio(systems, same), 1, 'shared DHL token must not suppress');
  assert.equal(systems[0].rows.length, 1);
  assert.equal(systems[0].rows[0][2], 'REF-X');

  // Fresh reference control in the same shape.
  const tControl = loadSplitter();
  tControl.rememberOutput([{ name: 'DHL EXPRESS', group: 'tariff', rows: [['DHL', 'K1', 'REF-X', 'D-X', [], '']] }]);
  const systemsControl = [{ name: 'DHL FREIGHT', group: 'tariff', rows: [] }];
  const fresh = [{ system: 'DHL', group: 'tariff', row: ['DHL', 'K2', 'REF-Y', 'D-Y', [], ''] }];
  assert.equal(tControl.reconcilePrio(systemsControl, fresh), 1);
  assert.equal(systemsControl[0].rows[0][2], 'REF-Y');

  // Missing branch: no uploaded system, PRIO name DHL FREIGHT.
  const t2 = loadSplitter();
  t2.rememberOutput([{ name: 'DHL EXPRESS', group: 'tariff', rows: [['DHL', 'K1', 'REF-X', 'D-X', [], '']] }]);
  const none = [];
  const prioOnly = [{ system: 'DHL FREIGHT', group: 'tariff', row: ['DHL', 'K2', 'REF-Y', 'D-Y', [], ''] }];
  assert.equal(t2.reconcilePrio(none, prioOnly), 1, 'shared DHL token must not suppress in the missing branch');
  assert.equal(none.length, 1);
  assert.equal(none[0].rows[0][2], 'REF-Y');
});

test('rememberOutput: a run whose rows all have blank identities does not wipe the memory', () => {
  const t = loadSplitter();
  t.rememberOutput([{ name: 'FNP', group: 'tariff', rows: [['DHL', 'K1', 'REF-1', 'D1', [], '']] }]);
  t.rememberOutput([{ name: 'FNP', group: 'tariff', rows: [['DHL', 'K2', '', '', [], '']] }]);
  const systems = [{ name: 'FNP', group: 'tariff', rows: [] }];
  const same = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K1', 'REF-1', 'D1', [], ''] }];
  assert.equal(t.reconcilePrio(systems, same), 0, 'previous memory must survive an empty-identity run');
  assert.equal(systems[0].rows.length, 0);
  const fresh = [{ system: 'FNP', group: 'tariff', row: ['DHL', 'K2', 'REF-2', 'D2', [], ''] }];
  assert.equal(t.reconcilePrio(systems, fresh), 1);
  assert.equal(systems[0].rows[0][2], 'REF-2');
});

test('previewSystem: surviving row count plus per-forwarder counts that sum to it', () => {
  const sys = {
    name: 'FNP', group: 'tariff',
    rows: [
      ['DHL', 'S', 'R', 'D1', []],
      ['DHL', 'S', 'R', 'D2', []],
      ['Kuehne', 'S', 'R', 'D3', []],
    ],
    forwarders: [{ name: 'DHL', checked: true }, { name: 'Kuehne', checked: true }],
  };
  const p = plain(s.previewSystem(sys, new Set(), true));
  assert.deepEqual(p, {
    name: 'FNP', rows: 3,
    forwarders: [{ name: 'DHL', count: 2 }, { name: 'Kuehne', count: 1 }],
  });
  assert.equal(p.forwarders.reduce((a, f) => a + f.count, 0), p.rows);
});

test('previewSystem: an unchecked forwarder is excluded from rows and from its own breakdown', () => {
  const sys = {
    name: 'FNP', group: 'tariff',
    rows: [['DHL', 'S', 'R', 'D1', []], ['Kuehne', 'S', 'R', 'D2', []]],
    forwarders: [{ name: 'DHL', checked: true }, { name: 'Kuehne', checked: false }],
  };
  const p = plain(s.previewSystem(sys, new Set(), true));
  assert.equal(p.rows, 1);
  assert.deepEqual(p.forwarders, [{ name: 'DHL', count: 1 }]);
});

test('previewSystem: tariff rows honour the note filter, factual rows ignore it', () => {
  const rows = [
    ['DHL', 'S', 'R', 'D1', []],
    ['DHL', 'S', 'R', 'D2', ['bad note']],
  ];
  const fwd = [{ name: 'DHL', checked: true }];
  const tariff = plain(s.previewSystem({ name: 'FNP', group: 'tariff', rows, forwarders: fwd }, new Set(), true));
  assert.equal(tariff.rows, 1);
  assert.deepEqual(tariff.forwarders, [{ name: 'DHL', count: 1 }]);
  const factual = plain(s.previewSystem({ name: 'KSP', group: 'factual', rows, forwarders: fwd }, new Set(), true));
  assert.equal(factual.rows, 2);
  assert.deepEqual(factual.forwarders, [{ name: 'DHL', count: 2 }]);
});

test('previewSystem: blank rows drop only when skipBlanks is on', () => {
  const rows = [
    ['DHL', 'S', 'R', 'D1', []],
    ['', '', '', '', ''],
  ];
  const sys = { name: 'KSP', group: 'factual', rows };
  assert.equal(s.previewSystem(sys, new Set(), false).rows, 2);
  assert.equal(s.previewSystem(sys, new Set(), true).rows, 1);
});
