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

test('projectBacklog: remaining over OPEN records only + oldest age', () => {
  const recs = [
    {project:'X', total:100, done:40, status:'Proses',  date:'2026-06-20'},
    {project:'X', total:50,  done:50, status:'Selesai', date:'2026-06-22'},
    {project:'Y', total:30,  done:0,  status:'Proses',  date:'2026-06-28'},
  ];
  const b = a.projectBacklog(recs, '2026-06-30');
  assert.equal(b.X.remaining, 60);
  assert.equal(b.X.openRecs, 1);
  assert.equal(b.X.oldestAgeDays, 10);
  assert.equal(b.Y.remaining, 30);
  assert.equal(b.Y.oldestAgeDays, 2);
});

test('throughputByPerson: avg done per active day within window', () => {
  const recs = [
    {staff:['Ihsa'], done:100, total:100, date:'2026-06-29'},
    {staff:['Ihsa'], done:140, total:140, date:'2026-06-30'},
    {staff:['Nico'], done:50,  total:50,  date:'2026-01-01'}, // out of 30d window
  ];
  const tp = a.throughputByPerson(recs, '2026-06-30', 30);
  assert.equal(tp.Ihsa, 120);
  assert.equal(tp.Nico, undefined);
});

test('capacityFor: throughput, half-day halves, default when unknown', () => {
  assert.equal(a.capacityFor('Ihsa', {Ihsa:120}, false), 120);
  assert.equal(a.capacityFor('Ihsa', {Ihsa:120}, true), 60);
  assert.equal(a.capacityFor('Ghost', {}, false), 150); // DEFAULT_CAPACITY
});

test('personLoadByDay + loadTier', () => {
  const asg = {
    x:{personId:'p1', date:'2026-06-30', qty:200},
    y:{personId:'p1', date:'2026-06-30', qty:50},
    z:{personId:'p2', date:'2026-06-29', qty:80},
  };
  const loads = a.personLoadByDay(asg, '2026-06-30');
  assert.equal(loads.p1, 250);
  assert.equal(loads.p2, undefined);
  assert.equal(a.loadTier(250, 220), 'over');
  assert.equal(a.loadTier(0, 150), 'free');
  assert.equal(a.loadTier(100, 150), 'ontrack');
});

test('riskTier: overdue / slip / tight / ontrack', () => {
  assert.equal(a.riskTier(1240, 4, 250).tier, 'slip');   // needs 310 > 250
  assert.equal(a.riskTier(1240, 4, 250).neededPerDay, 310);
  assert.equal(a.riskTier(880, 5, 200).tier, 'ontrack');  // needs 176
  assert.equal(a.riskTier(100, 0, 0).tier, 'overdue');
  assert.equal(a.riskTier(0, 3, 0).tier, 'ontrack');
  assert.equal(a.riskTier(190, 1, 200).tier, 'tight');    // 190 > 180 (0.9*200)
});
