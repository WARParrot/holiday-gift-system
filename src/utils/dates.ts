/** Birthday date helpers. Kept framework-agnostic and easy to unit test. */

import type { ISODate } from '../types';

/** Returns the number of whole days until the next occurrence of a birthday. */
export function daysUntilBirthday(birthDate: ISODate, from: Date = new Date()): number {
  const dob = new Date(birthDate);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
  if (next < today) {
    next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((next.getTime() - today.getTime()) / msPerDay);
}

/** Formats a birthday for display, e.g. "Jul 10". */
export function formatBirthday(birthDate: ISODate): string {
  return new Date(birthDate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** Formats a datetime for chat messages, e.g. "Jul 1, 09:30". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
