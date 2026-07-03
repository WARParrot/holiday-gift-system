import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntilBirthday, nextBirthdayYear } from '../src/util/dates.js';

/**
 * Date arithmetic edge cases — chiefly the Feb-29 leap-year birthday, which is
 * the classic off-by-one/overflow trap in birthday countdowns.
 */
test('daysUntilBirthday returns 0 when the birthday is today', () => {
  const today = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15
  assert.equal(daysUntilBirthday('1990-06-15', today), 0);
});

test('daysUntilBirthday counts forward within the same year', () => {
  const from = new Date(Date.UTC(2026, 5, 10)); // 2026-06-10
  assert.equal(daysUntilBirthday('1990-06-15', from), 5);
});

test('daysUntilBirthday rolls over to next year once the date has passed', () => {
  const from = new Date(Date.UTC(2026, 5, 20)); // 2026-06-20, birthday already passed
  // 2026-06-20 → 2027-06-15 is 360 days (2027 is not a leap year).
  assert.equal(daysUntilBirthday('1990-06-15', from), 360);
});

test('daysUntilBirthday handles a Feb-29 birthday in a non-leap year without throwing', () => {
  // From 2025-02-27 (2025 is NOT a leap year). JS Date normalises 2025-02-29
  // to 2025-03-01, so the countdown is a finite, non-negative number of days.
  const from = new Date(Date.UTC(2025, 1, 27));
  const days = daysUntilBirthday('2000-02-29', from);
  assert.ok(Number.isFinite(days));
  assert.ok(days >= 0 && days <= 366, `expected a sane day count, got ${days}`);
});

test('daysUntilBirthday is exact for a Feb-29 birthday in a leap year', () => {
  const from = new Date(Date.UTC(2028, 1, 27)); // 2028 IS a leap year, from 2028-02-27
  assert.equal(daysUntilBirthday('2000-02-29', from), 2); // 27→28→29
});

test('nextBirthdayYear picks the correct cycle year around the boundary', () => {
  const before = new Date(Date.UTC(2026, 5, 10));
  assert.equal(nextBirthdayYear('1990-06-15', before), 2026);
  const after = new Date(Date.UTC(2026, 5, 20));
  assert.equal(nextBirthdayYear('1990-06-15', after), 2027);
});
