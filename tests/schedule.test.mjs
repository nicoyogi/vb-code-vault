/* Unit tests for the pure schedule helpers in alokasi-project.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAlokasi } from './harness/load-alokasi.mjs';

const a = loadAlokasi();

test('mondayOf: rolls any weekday/weekend back to that week Monday', () => {
  assert.equal(a.mondayOf('2026-06-30'), '2026-06-29'); // Tue -> Mon
  assert.equal(a.mondayOf('2026-06-29'), '2026-06-29'); // Mon -> itself
  assert.equal(a.mondayOf('2026-07-05'), '2026-06-29'); // Sun -> that week Mon
});

test('weekDates: five Mon-Fri ISO dates of the week', () => {
  assert.deepEqual(
    Array.from(a.weekDates('2026-07-01')),
    ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03']
  );
});

test('personLeaveOn: matches by personId + date range, full beats half', () => {
  const hols = [
    { personId: 'p1', start: '2026-06-30', end: '2026-07-03', type: 'vacation' },
    { personId: 'p2', start: '2026-07-01', end: '2026-07-01', type: 'sick', halfDay: true, halfDayPart: 'AM' },
    { personId: 'p1', start: '2026-07-01', end: '2026-07-01', type: 'wfh', halfDay: true, halfDayPart: 'PM' },
  ];
  assert.equal(a.personLeaveOn(hols, 'p1', '2026-07-01').type, 'vacation'); // full wins
  assert.equal(a.personLeaveOn(hols, 'p2', '2026-07-01').halfDay, true);
  assert.equal(a.personLeaveOn(hols, 'p1', '2026-07-04'), null);            // out of range
  assert.equal(a.personLeaveOn(hols, 'p3', '2026-07-01'), null);            // no such person
});

test('publicHolidayName: exact date lookup', () => {
  const ph = [{ date: '2026-07-01', name: 'Test Day' }];
  assert.equal(a.publicHolidayName(ph, '2026-07-01'), 'Test Day');
  assert.equal(a.publicHolidayName(ph, '2026-07-02'), null);
});
