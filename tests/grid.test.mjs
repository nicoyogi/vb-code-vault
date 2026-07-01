/* Unit tests for the pure grid helpers in alokasi-project.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
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
