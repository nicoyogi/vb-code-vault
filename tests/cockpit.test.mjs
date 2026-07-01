/* Unit tests for the pure cockpit decision helpers in alokasi-project.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAlokasi } from './harness/load-alokasi.mjs';

const a = loadAlokasi();

test('projectSlug: lowercase, non-alnum -> _, trimmed', () => {
  assert.equal(a.projectSlug('TRUMPF'), 'trumpf');
  assert.equal(a.projectSlug('Siemens Freia'), 'siemens_freia');
  assert.equal(a.projectSlug('A/B C!'), 'a_b_c');
  assert.equal(a.projectSlug(''), '');
});

test('ageDays: whole days, clamped at 0', () => {
  assert.equal(a.ageDays('2026-06-20', '2026-06-30'), 10);
  assert.equal(a.ageDays('2026-07-10', '2026-06-30'), 0); // future record
  assert.equal(a.ageDays('', '2026-06-30'), 0);
});

test('workingDaysBetween: Mon-Fri inclusive, minus public holidays', () => {
  assert.equal(a.workingDaysBetween('2026-06-29', '2026-07-03', []), 5); // Mon..Fri
  assert.equal(a.workingDaysBetween('2026-06-29', '2026-07-03', [{date:'2026-07-01'}]), 4);
  assert.equal(a.workingDaysBetween('2026-06-29', '2026-06-29', []), 1); // single Mon
  assert.equal(a.workingDaysBetween('2026-06-29', '2026-07-05', []), 5); // Sun excluded
  assert.equal(a.workingDaysBetween('2026-07-03', '2026-06-29', []), 0); // from > to
});

