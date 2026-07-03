import type { Subscription, UserRow } from '../types/domain.js';

/**
 * External Calendar Synchronization service.
 *
 * The spec requires bidirectional sync with Google Calendar and Yandex
 * Calendar: when a user subscribes to a friend/group, a recurring yearly
 * birthday event should be injected into their connected external calendar.
 *
 * Real OAuth2 + Calendar API calls require live third-party credentials that
 * cannot be provisioned in this environment. This module therefore implements
 * the full integration SHAPE behind a provider interface:
 *
 *   - `CalendarProvider` is the contract a real Google/Yandex adapter fulfils.
 *   - `RecordingCalendarProvider` is an in-memory adapter used by default and
 *     in tests; it records exactly the RFC-5545-style recurring events that
 *     would be pushed, so the behaviour is observable and verifiable.
 *
 * To go live, implement `CalendarProvider` with googleapis / Yandex REST + an
 * OAuth2 token store and swap it in at construction. No call site changes.
 */
export interface CalendarEvent {
  /** Stable id derived from subscriber + subject so re-sync is idempotent. */
  uid: string;
  summary: string;
  /** Recurrence rule, e.g. FREQ=YEARLY. */
  rrule: string;
  /** Event date `YYYY-MM-DD` (the birthday, month/day significant). */
  date: string;
  provider: 'google' | 'yandex';
}

export interface CalendarProvider {
  readonly name: 'google' | 'yandex';
  upsertEvent(event: CalendarEvent): Promise<void>;
  removeEvent(uid: string): Promise<void>;
}

export class RecordingCalendarProvider implements CalendarProvider {
  readonly name: 'google' | 'yandex';
  readonly events = new Map<string, CalendarEvent>();

  constructor(name: 'google' | 'yandex' = 'google') {
    this.name = name;
  }

  async upsertEvent(event: CalendarEvent): Promise<void> {
    this.events.set(event.uid, event);
  }

  async removeEvent(uid: string): Promise<void> {
    this.events.delete(uid);
  }
}

export class CalendarSyncService {
  constructor(private readonly providers: CalendarProvider[]) {}

  private buildEvent(sub: Subscription, subject: UserRow, provider: CalendarProvider['name']): CalendarEvent {
    return {
      uid: `bcms-${sub.subscriberId}-${subject.id}@bcms`,
      summary: `🎂 ${subject.fullName}'s birthday`,
      rrule: 'FREQ=YEARLY',
      date: subject.birthdate,
      provider,
    };
  }

  /** Inject a recurring yearly birthday event for each subject into every provider. */
  async syncSubjects(sub: Subscription, subjects: UserRow[]): Promise<CalendarEvent[]> {
    const pushed: CalendarEvent[] = [];
    if (!sub.calendarSync) return pushed;
    for (const provider of this.providers) {
      for (const subject of subjects) {
        const event = this.buildEvent(sub, subject, provider.name);
        await provider.upsertEvent(event);
        pushed.push(event);
      }
    }
    return pushed;
  }

  async removeSubjects(sub: Subscription, subjects: UserRow[]): Promise<void> {
    for (const provider of this.providers) {
      for (const subject of subjects) {
        await provider.removeEvent(`bcms-${sub.subscriberId}-${subject.id}@bcms`);
      }
    }
  }
}
