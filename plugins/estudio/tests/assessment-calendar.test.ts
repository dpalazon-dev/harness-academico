import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, daysBetween, localDate } from '../src/assessment/calendar.ts';

test('Madrid local dates straddle March and October DST without 24-hour date addition', () => {
  assert.equal(localDate('2026-03-28T23:30:00.000Z', 'Europe/Madrid'), '2026-03-29');
  assert.equal(localDate('2026-03-29T22:30:00.000Z', 'Europe/Madrid'), '2026-03-30');
  assert.equal(localDate('2026-10-24T22:30:00.000Z', 'Europe/Madrid'), '2026-10-25');
  assert.equal(localDate('2026-10-25T23:30:00.000Z', 'Europe/Madrid'), '2026-10-26');
  assert.equal(addDays('2026-03-29', 2), '2026-03-31');
  assert.equal(addDays('2026-10-25', 2), '2026-10-27');
  assert.equal(daysBetween('2026-03-29', '2026-04-05'), 7);
  assert.equal(daysBetween('2026-10-25', '2026-11-01'), 7);
});

test('Gregorian leap days, month/year boundaries and signed differences', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(daysBetween('2027-01-01', '2026-12-31'), -1);
});

test('calendar rejects invalid dates, noncanonical UTC, unsupported zones and fractional offsets', () => {
  for (const day of ['2026-02-29', '2026-04-31', '2026-2-01', 'not-a-date']) {
    assert.throws(() => addDays(day, 1));
    assert.throws(() => daysBetween(day, '2026-03-01'));
  }
  for (const instant of ['2026-01-01', '2026-01-01T00:00:00Z', '2026-02-30T00:00:00.000Z']) {
    assert.throws(() => localDate(instant, 'Europe/Madrid'));
  }
  assert.throws(() => localDate('2026-01-01T00:00:00.000Z', 'Not/A_Zone'));
  assert.throws(() => addDays('2026-01-01', 1.5));
  assert.throws(() => addDays('9999-12-31', 1));
});
