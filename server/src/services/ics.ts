import type { CalendarEvent } from './calendarSync.js';

/** The subset of event fields the ICS serialiser needs. */
export type IcsEventInput = Pick<CalendarEvent, 'uid' | 'summary' | 'rrule' | 'date'>;

/**
 * Minimal, spec-correct iCalendar (RFC 5545) serialisation for the birthday
 * VEVENTs we push to CalDAV servers (Yandex). We only need a single recurring
 * all-day VEVENT per resource, so this is deliberately small rather than a full
 * iCal library — but it does the things that actually matter for interop:
 *  - CRLF line endings and a trailing CRLF (RFC 5545 §3.1);
 *  - line folding at 75 octets;
 *  - TEXT escaping for SUMMARY (commas, semicolons, backslashes, newlines);
 *  - all-day DATE value (VALUE=DATE) with a yearly RRULE.
 */

/** Escape a TEXT value per RFC 5545 §3.3.11. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a content line to <=75 octets with CRLF + single leading space. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let start = 0;
  // First chunk 75 octets, continuations 74 (one octet used by the leading space).
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte UTF-8 sequence: back off to a lead-byte boundary.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return chunks.join('\r\n ');
}

function toDateValue(isoDate: string): string {
  // 'YYYY-MM-DD' -> 'YYYYMMDD'
  return isoDate.replace(/-/g, '').slice(0, 8);
}

/**
 * Build a VCALENDAR wrapping one recurring all-day birthday VEVENT.
 * `dtstamp` is injectable so tests are deterministic.
 */
export function buildBirthdayIcs(event: IcsEventInput, dtstamp: Date = new Date()): string {
  const stamp = `${dtstamp.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  const dtstart = toDateValue(event.date);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BCMS//Birthday Celebration Management System//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `RRULE:${event.rrule}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
