import type { Subscription, UserRow, CalendarProviderName } from '../types/domain.js';
import type { AppConfig, GoogleOAuthConfig, YandexOAuthConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import { CalendarOAuthService } from './calendarOAuth.js';
import { buildBirthdayIcs } from './ics.js';

/**
 * External Calendar Synchronization service.
 *
 * When a user subscribes to a friend/group with calendar sync on, a recurring
 * yearly birthday event is pushed into each external calendar that user has
 * connected. Sync is therefore **per-user** — it depends on that user's own
 * OAuth tokens and connected providers, not a fixed global provider list.
 *
 * Two adapter implementations sit behind one interface:
 *   - live adapters (`GoogleCalendarProvider`, `YandexCalendarProvider`) call
 *     the real Google Calendar REST API / Yandex CalDAV service with the user's
 *     OAuth bearer token;
 *   - `RecordingCalendarProvider` is an in-memory stand-in used automatically
 *     for any provider that isn't configured with OAuth credentials, so the
 *     demo and the test suite run with zero external setup.
 *
 * Which one is used is decided per provider at construction from `config`.
 */
export interface CalendarEvent {
  /** Stable id derived from subscriber + subject so re-sync is idempotent. */
  uid: string;
  summary: string;
  /** Recurrence rule, e.g. FREQ=YEARLY. */
  rrule: string;
  /** Event date `YYYY-MM-DD` (the birthday, month/day significant). */
  date: string;
  provider: CalendarProviderName;
}

/** Auth/context handed to an adapter for a single user's push. */
export interface CalendarAuth {
  accessToken: string;
  /** Provider account login/email (Yandex CalDAV path needs it). */
  accountLogin: string;
}

export interface CalendarProvider {
  readonly name: CalendarProviderName;
  /** True for adapters that hit a real external service (need a valid token). */
  readonly live: boolean;
  upsertEvent(auth: CalendarAuth, event: CalendarEvent): Promise<void>;
  removeEvent(auth: CalendarAuth, uid: string): Promise<void>;
}

/** In-memory adapter — records what would be pushed. Demo/test default. */
export class RecordingCalendarProvider implements CalendarProvider {
  readonly name: CalendarProviderName;
  readonly live = false;
  readonly events = new Map<string, CalendarEvent>();

  constructor(name: CalendarProviderName = 'google') {
    this.name = name;
  }

  async upsertEvent(_auth: CalendarAuth, event: CalendarEvent): Promise<void> {
    this.events.set(event.uid, event);
  }

  async removeEvent(_auth: CalendarAuth, uid: string): Promise<void> {
    this.events.delete(uid);
  }
}

/**
 * Live Google Calendar adapter (Calendar API v3, raw REST).
 *
 * Idempotency: we use a deterministic event id derived from the event uid so a
 * re-sync updates the same event instead of duplicating. Google event ids must
 * match [a-v0-9]{5,1024}; we encode the uid to base32hex to satisfy that.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google' as const;
  readonly live = true;

  constructor(private readonly cfg: GoogleOAuthConfig) {}

  private eventId(uid: string): string {
    // base32hex alphabet (0-9a-v), lowercase, no padding — valid Google id chars.
    let out = '';
    const bytes = Buffer.from(uid, 'utf8');
    for (const b of bytes) out += b.toString(32).padStart(2, '0');
    return out.slice(0, 1024);
  }

  private async send(auth: CalendarAuth, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.cfg.apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async upsertEvent(auth: CalendarAuth, event: CalendarEvent): Promise<void> {
    const cal = encodeURIComponent(this.cfg.calendarId);
    const id = this.eventId(event.uid);
    const payload = {
      id,
      summary: event.summary,
      start: { date: event.date },
      end: { date: event.date },
      recurrence: [`RRULE:${event.rrule}`],
      transparency: 'transparent',
    };
    // Try update (PUT) first; if the event doesn't exist yet, insert it.
    let res = await this.send(auth, 'PUT', `/calendars/${cal}/events/${id}`, payload);
    if (res.status === 404 || res.status === 410) {
      res = await this.send(auth, 'POST', `/calendars/${cal}/events`, payload);
    }
    if (!res.ok) {
      throw new Error(`Google Calendar upsert failed: ${res.status} ${await safeText(res)}`);
    }
  }

  async removeEvent(auth: CalendarAuth, uid: string): Promise<void> {
    const cal = encodeURIComponent(this.cfg.calendarId);
    const id = this.eventId(uid);
    const res = await this.send(auth, 'DELETE', `/calendars/${cal}/events/${id}`);
    // 404/410 = already gone — treat as success (idempotent delete).
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`Google Calendar delete failed: ${res.status} ${await safeText(res)}`);
    }
  }
}

/**
 * Live Yandex Calendar adapter (CalDAV, authenticated with the OAuth bearer).
 *
 * Each event is a single-VEVENT .ics resource PUT to a stable href under the
 * user's events collection; the href is derived from the uid so re-sync is
 * idempotent. DELETE removes it.
 */
export class YandexCalendarProvider implements CalendarProvider {
  readonly name = 'yandex' as const;
  readonly live = true;

  constructor(private readonly cfg: YandexOAuthConfig) {}

  private resourceHref(auth: CalendarAuth, uid: string): string {
    const collection = this.cfg.calendarPathTemplate.replace('{login}', encodeURIComponent(auth.accountLogin));
    const file = `${encodeURIComponent(uid)}.ics`;
    return `${this.cfg.caldavBase}${collection}${file}`;
  }

  async upsertEvent(auth: CalendarAuth, event: CalendarEvent): Promise<void> {
    const ics = buildBirthdayIcs({ uid: event.uid, summary: event.summary, date: event.date, rrule: event.rrule });
    const res = await fetch(this.resourceHref(auth, event.uid), {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'text/calendar; charset=utf-8',
      },
      body: ics,
    });
    if (!res.ok) {
      throw new Error(`Yandex CalDAV PUT failed: ${res.status} ${await safeText(res)}`);
    }
  }

  async removeEvent(auth: CalendarAuth, uid: string): Promise<void> {
    const res = await fetch(this.resourceHref(auth, uid), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Yandex CalDAV DELETE failed: ${res.status} ${await safeText(res)}`);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}

export class CalendarSyncService {
  private readonly providers: Record<CalendarProviderName, CalendarProvider>;

  constructor(
    private readonly deps: {
      repo: Repository;
      config: AppConfig;
      oauth: CalendarOAuthService;
      /** Override adapters (tests inject recording/mocks). */
      providers?: Partial<Record<CalendarProviderName, CalendarProvider>>;
    },
  ) {
    const { config } = deps;
    this.providers = {
      google:
        deps.providers?.google ??
        (config.calendar.google ? new GoogleCalendarProvider(config.calendar.google) : new RecordingCalendarProvider('google')),
      yandex:
        deps.providers?.yandex ??
        (config.calendar.yandex ? new YandexCalendarProvider(config.calendar.yandex) : new RecordingCalendarProvider('yandex')),
    };
  }

  /** Expose an adapter (tests assert against the recording provider). */
  providerFor(name: CalendarProviderName): CalendarProvider {
    return this.providers[name];
  }

  isLive(name: CalendarProviderName): boolean {
    return this.providers[name].live;
  }

  private buildEvent(sub: Subscription, subject: UserRow, provider: CalendarProviderName): CalendarEvent {
    return {
      uid: `bcms-${sub.subscriberId}-${subject.id}`,
      summary: `🎂 ${subject.fullName}'s birthday`,
      rrule: 'FREQ=YEARLY',
      date: subject.birthdate,
      provider,
    };
  }

  /**
   * Resolve a usable auth context for a live provider, refreshing the access
   * token if it's expired. Returns null when the provider is a recording stub
   * (no auth needed) or the user hasn't completed OAuth for it.
   */
  private async authFor(userId: string, provider: CalendarProviderName): Promise<CalendarAuth | null> {
    if (!this.providers[provider].live) return { accessToken: '', accountLogin: '' };
    const token = this.deps.repo.getCalendarToken(userId, provider);
    if (!token) return null;
    const accessToken = await this.deps.oauth.getValidAccessToken(userId, provider, token);
    if (!accessToken) return null;
    return { accessToken, accountLogin: token.accountLogin };
  }

  /**
   * Push a recurring yearly birthday event for each subject into every provider
   * the subscriber has connected. Only runs when the subscription opted into
   * calendar sync. Returns the events that were pushed (for the response/UI).
   */
  async syncSubjects(sub: Subscription, subjects: UserRow[]): Promise<CalendarEvent[]> {
    const pushed: CalendarEvent[] = [];
    if (!sub.calendarSync) return pushed;
    const connected = this.deps.repo.listCalendarConnections(sub.subscriberId).map((c) => c.provider);
    for (const provider of connected) {
      const auth = await this.authFor(sub.subscriberId, provider);
      if (!auth) continue; // live provider without a valid token — skip silently
      const adapter = this.providers[provider];
      for (const subject of subjects) {
        const event = this.buildEvent(sub, subject, provider);
        await adapter.upsertEvent(auth, event);
        pushed.push(event);
      }
    }
    return pushed;
  }

  /** Remove the birthday events for these subjects from the user's calendars. */
  async removeSubjects(sub: Subscription, subjects: UserRow[]): Promise<void> {
    const connected = this.deps.repo.listCalendarConnections(sub.subscriberId).map((c) => c.provider);
    for (const provider of connected) {
      const auth = await this.authFor(sub.subscriberId, provider);
      if (!auth) continue;
      const adapter = this.providers[provider];
      for (const subject of subjects) {
        await adapter.removeEvent(auth, `bcms-${sub.subscriberId}-${subject.id}`);
      }
    }
  }
}
