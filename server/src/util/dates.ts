import { randomUUID } from 'node:crypto';

/** Generate a stable unique id for a row. */
export function newId(): string {
  return randomUUID();
}

/**
 * Compute how many days until a person's next birthday from a reference date.
 * Uses month/day only (year-agnostic). Returns 0 when the birthday is today.
 */
export function daysUntilBirthday(birthdate: string, from: Date = new Date()): number {
  const [, mStr, dStr] = birthdate.split('-');
  const month = Number(mStr);
  const day = Number(dStr);
  const ref = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let next = new Date(Date.UTC(ref.getUTCFullYear(), month - 1, day));
  if (next.getTime() < ref.getTime()) {
    next = new Date(Date.UTC(ref.getUTCFullYear() + 1, month - 1, day));
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((next.getTime() - ref.getTime()) / msPerDay);
}

/** The calendar year the person's *next* birthday falls in (for pool cycle keys). */
export function nextBirthdayYear(birthdate: string, from: Date = new Date()): number {
  const [, mStr, dStr] = birthdate.split('-');
  const month = Number(mStr);
  const day = Number(dStr);
  const ref = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const thisYear = new Date(Date.UTC(ref.getUTCFullYear(), month - 1, day));
  return thisYear.getTime() < ref.getTime() ? ref.getUTCFullYear() + 1 : ref.getUTCFullYear();
}
