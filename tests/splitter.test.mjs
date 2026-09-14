/* Unit tests for the pure extract/split helpers in File_splitter.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSplitter } from './harness/load-splitter.mjs';

const s = loadSplitter();
// vm-realm arrays/objects have a foreign prototype; JSON round-trip re-homes
// them so deepStrictEqual compares by value.
const plain = x => JSON.parse(JSON.stringify(x));

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
  assert.deepEqual(plain(s.balancedSizes(9, [1, 0.5])), [6, 3]);          // 1 full + 1 half -> 2:1
  assert.deepEqual(plain(s.balancedSizes(10, [1, 1, 0.5])), [4, 4, 2]);   // 2 full + 1 half -> 2:2:1
  assert.deepEqual(plain(s.balancedSizes(100, [1, 0.5, 0.5])), [50, 25, 25]);
  // edge cases
  assert.deepEqual(plain(s.balancedSizes(0, [1, 0.5])), [0, 0]);          // nothing to give
  assert.deepEqual(plain(s.balancedSizes(3, [0.5])), [3]);                // single half-day person takes all
  assert.deepEqual(plain(s.balancedSizes(6, [1, 1])), [3, 3]);            // all full -> equal (old balancedSizes(6,2))
  const sizes = s.balancedSizes(79, [1, 1, 1]);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 79);                     // nothing lost/duplicated
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

test('systemShares: half-day weight sizes shares ~half of full-day, both pools covered once', () => {
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
    // the full-day share (weight 1) holds ~2x the half-day share (weight 0.5),
    // within ±1 — the dominant share is either person when shuffled
    const byPerson = counts => {
      const [a, b] = counts.sort((x, y) => y - x); // larger first
      return Math.abs(a - 2 * b) <= 1;
    };
    const main = shares.map(sh => sh.filter(r => !isPrioRow(r)).length);
    assert.equal(byPerson(main), true, `main ≈2:1, got ${main}`);
    const prio = shares.map(sh => sh.filter(isPrioRow).length);
    assert.equal(byPerson(prio), true, `prio ≈2:1, got ${prio}`);
  }
  // all-full weights -> equal shares, identical to the pre-weights path
  const rows2 = [row('P0', true), row('P1', true), row('R0', false), row('R1', false)];
  const s1 = s.systemShares(rows2, [1, 1], false, isPrioRow);
  const s2 = s.systemShares(rows2, 2, false, isPrioRow);
  assert.deepEqual(plain(s1), plain(s2));
});

test('systemShares: more shares than rows (weights) -> empty shares, nothing lost', () => {
  const row = d => ['V', 'S', 'R', d, [], ''];
  const shares = s.systemShares([row('1')], [1, 0.5], false, () => false);
  assert.deepEqual(plain(shares.map(sh => sh.length)), [1, 0]); // full takes all, half gets 0
});
