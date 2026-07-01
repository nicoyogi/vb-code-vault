/* Unit tests for the pure grid helpers in alokasi-project.html. */
import test from 'node:test';
/* non-strict assert (not node:assert/strict like the other test files): the harness runs
   the app in a node:vm sandbox, so values these helpers return live in the sandbox realm;
   assert/strict's deepStrictEqual fails on cross-realm prototype identity even when the
   values match. Keep non-strict here — do not switch back to /strict. */
import assert from 'node:assert';
import { loadAlokasi } from './harness/load-alokasi.mjs';

const a = loadAlokasi();

test('cellDocId: date + project slug', () => {
  assert.equal(a.cellDocId('2025-12-17', 'WMF'), '2025-12-17_wmf');
  assert.equal(a.cellDocId('2025-12-17', 'Siemens Freia'), '2025-12-17_siemens_freia');
  assert.equal(a.cellDocId('2025-12-17', 'Conti Download'), '2025-12-17_conti_download');
});

test('cellIsEmpty: empty people AND blank note', () => {
  assert.equal(a.cellIsEmpty([], ''), true);
  assert.equal(a.cellIsEmpty(undefined, '   '), true);
  assert.equal(a.cellIsEmpty(['p1'], ''), false);
  assert.equal(a.cellIsEmpty([], '161'), false);
});

test('visibleColumns: ordered by order then name, hidden excluded', () => {
  const meta = {
    wmf:    { name: 'WMF',    order: 1 },
    krones: { name: 'KRONES', order: 0 },
    dead:   { name: 'OLD',    order: 2, hidden: true },
    noname: { order: 3 },
  };
  assert.deepEqual(a.visibleColumns(meta), ['KRONES', 'WMF']);
  assert.deepEqual(a.visibleColumns({}), []);
});

test('swapOrder: swaps order with the neighbour in move direction', () => {
  const meta = { krones: { name: 'KRONES', order: 0 }, wmf: { name: 'WMF', order: 1 } };
  assert.deepEqual(a.swapOrder(meta, 'wmf', -1), [{ slug: 'wmf', order: 0 }, { slug: 'krones', order: 1 }]);
  assert.deepEqual(a.swapOrder(meta, 'krones', 1), [{ slug: 'krones', order: 1 }, { slug: 'wmf', order: 0 }]);
  assert.deepEqual(a.swapOrder(meta, 'krones', -1), []); // already first
  assert.deepEqual(a.swapOrder(meta, 'wmf', 1), []);     // already last
});

test('setCell: defined and callable without throwing (stubbed Firestore)', async () => {
  assert.equal(typeof a.setCell, 'function');
  await a.setCell('2025-12-17', 'WMF', ['p1', 'p2'], '161'); // upsert path
  await a.setCell('2025-12-17', 'WMF', [], '');              // delete path
});
