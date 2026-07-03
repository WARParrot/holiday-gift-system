import type { Subscription, UserRow, CalendarProviderName } from '../types/domain.js';
import type { AppConfig, GoogleOAuthConfig, YandexCalDavConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import { CalendarOAuthService } from './calendarOAuth.js';
import { buildBirthdayIcs } from './ics.js';

/**
 * External Calendar Synchronization service.
 *
 * When a user subscribes to a friend/group with calendar sync on, a recurring
 * yearly birthday event is pushed into each external calendar that user has
 * connected. Sync is therefore **per-user** — it depends on that user's own
 * stored credentials and connected providers, not a fixed global provider list.
 *
 * The two live providers authenticate DIFFERENTLY, reflecting what each vendor
 * actually exposes (verified against their official docs):
 *   - **Google** — OAuth2 + Calendar API v3 (REST). Auth = `Bearer <token>`,
 *     obtained via the authorization-code flow and refreshed on expiry.
 *   - **Yandex** — CalDAV. Auth = HTTP Basic with the account login + an
 *     app-specific password. Yandex Calendar does NOT accept an OAuth bearer
 *     token for CalDAV, so it is deliberately not an OAuth provider here.
 *
 * `RecordingCalendarProvider` is an in-memory stand-in used automatically for
 * any provider that isn't configured, so the demo and tests run with zero setup.
 * Which adapter is used is decided per provider at construction from `config`.
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

/**
 * Auth/context handed to an adapter for a single user's push. `authHeader` is
 * the fully-formed `Authorization` value — `Bearer <token>` for Google,
 * `Basic base64(login:app-password)` for Yandex — so adapters stay agnostic to
 * how the credential was obtained. `accountLogin` is needed for the Yandex
 * CalDAV collection path.
 */
export interface CalendarAuth {
  authHeader: string;
  accountLogin: string;
}

export interface CalendarProvider {
  readonly name: CalendarProviderName;
  /** True for adapters that hit a real external service (need real credentials). */
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
        authorization: auth.authHeader,
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

/** Build the `Authorization: Basic …` value for a Yandex login + app password. */
export function basicAuthHeader(login: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${login}:${appPassword}`, 'utf8').toString('base64')}`;
}

/**
 * Live Yandex Calendar adapter (CalDAV, authenticated with HTTP Basic auth
 * using the account login + an app-specific password).
 *
 * Per Yandex's official docs, Yandex Calendar syncs over CalDAV and requires an
 * app password (Yandex ID → App passwords → Calendar); it does NOT accept an
 * OAuth bearer token. `auth.authHeader` is therefore a `Basic base64(login:pw)`
 * value assembled by the sync service from the user's stored credential.
 *
 * Each event is a single-VEVENT .ics resource PUT to a stable href under the
 * user's events collection; the href is derived from the uid so re-sync is
 * idempotent. DELETE removes it.
 */
export class YandexCalendarProvider implements CalendarProvider {
  readonly name = 'yandex' as const;
  readonly live = true;

  constructor(private readonly cfg: YandexCalDavConfig) {}

  private collectionUrl(accountLogin: string): string {
    const collection = this.cfg.calendarPathTemplate.replace('{login}', encodeURIComponent(accountLogin));
    return `${this.cfg.caldavBase}${collection}`;
  }

  private resourceHref(auth: CalendarAuth, uid: string): string {
    return `${this.collectionUrl(auth.accountLogin)}${encodeURIComponent(uid)}.ics`;
  }

  /**
   * Validate a login + app password against the CalDAV server before we store
   * them, by issuing a depth-0 PROPFIND on the user's events collection. Returns
   * true on 2xx/207 (Multi-Status), false on 401/403 (bad credential). This lets
   * the connect endpoint reject a wrong app password up front instead of failing
   * silently later during background sync.
   */
  static async verifyCredentials(cfg: YandexCalDavConfig, login: string, appPassword: string): Promise<boolean> {
    const collection = cfg.calendarPathTemplate.replace('{login}', encodeURIComponent(login));
    const res = await fetch(`${cfg.caldavBase}${collection}`, {
      method: 'PROPFIND',
      headers: {
        authorization: basicAuthHeader(login, appPassword),
        depth: '0',
        'content-type': 'application/xml; charset=utf-8',
      },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    });
    // 207 Multi-Status is the CalDAV success; some servers answer 200. 401/403
    // mean the credential is wrong. Anything else we treat as unverified.
    return res.status === 207 || res.ok;
  }

  async upsertEvent(auth: CalendarAuth, event: CalendarEvent): Promise<void> {
    const ics = buildBirthdayIcs({ uid: event.uid, summary: event.summary, date: event.date, rrule: event.rrule });
    const res = await fetch(this.resourceHref(auth, event.uid), {
      method: 'PUT',
      headers: {
        authorization: auth.authHeader,
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
      headers: { authorization: auth.authHeader },
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
   * Resolve a usable auth context for a live provider. Returns null when the
   * user has no stored credential for it (so sync skips it silently).
   *
   * The two providers differ:
   *   - **Google**: the stored token is an OAuth token; refresh it if expired
   *     and send `Bearer <access token>`.
   *   - **Yandex**: the stored "token" is an app password (tokenType 'Basic',
   *     accessToken = app password, accountLogin = login); send Basic auth. No
   *     refresh — app passwords don't expire until revoked.
   *
   * A recording (non-live) provider needs no auth.
   */
  private async authFor(userId: string, provider: CalendarProviderName): Promise<CalendarAuth | null> {
    if (!this.providers[provider].live) return { authHeader: '', accountLogin: '' };
    const cred = this.deps.repo.getCalendarToken(userId, provider);
    if (!cred) return null;

    if (provider === 'yandex') {
      // accessToken holds the app password; accountLogin holds the Yandex login.
      if (!cred.accessToken || !cred.accountLogin) return null;
      return {
        authHeader: basicAuthHeader(cred.accountLogin, cred.accessToken),
        accountLogin: cred.accountLogin,
      };
    }

    // Google (OAuth): refresh on expiry, then Bearer.
    const accessToken = await this.deps.oauth.getValidAccessToken(userId, provider, cred);
    if (!accessToken) return null;
    return { authHeader: `Bearer ${accessToken}`, accountLogin: cred.accountLogin };
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
