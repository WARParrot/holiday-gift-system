import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppConfig {
  host: string;
  port: number;
  jwtSecret: string;
  /** Access token lifetime in seconds. */
  jwtTtl: number;
  /** SQLite file path, or ':memory:' for tests. */
  dbFile: string;
  /** Reminder offsets (days before birthday) that generate notifications. */
  reminderOffsets: number[];
  /** Days before a birthday that a crowdfunding pool auto-opens. */
  poolLeadDays: number;
  /** Default crowdfunding target when a pool opens. */
  poolDefaultTarget: number;
  /** When true, the reminder/pool scheduler runs on an interval. */
  enableScheduler: boolean;
  schedulerIntervalMs: number;
  /** Optional path to the built web SPA (dist). When set, it's served statically. */
  webDist: string | null;
  /**
   * Allowed CORS origins. Empty array = same-origin only (no CORS headers),
   * the safe default for single-process production. `['*']` opens it to any
   * origin (dev convenience only). Set CORS_ORIGINS to a comma-separated list.
   */
  corsOrigins: string[];
  /** True in production (NODE_ENV=production): enables security hard-fails. */
  isProduction: boolean;
  /** Rate-limit knobs (fixed-window, in-process). */
  rateLimit: {
    /** Window length in milliseconds. */
    windowMs: number;
    /** Max general API requests per IP per window. */
    max: number;
    /** Max auth (login/register) attempts per IP per window. */
    authMax: number;
  };
  /**
   * Public base URL the browser reaches this server on (scheme + host [+ port]),
   * used to build OAuth redirect URIs. Defaults to http://localhost:<port>.
   */
  publicBaseUrl: string;
  /** External-calendar OAuth config. A provider is "live" only when configured. */
  calendar: {
    google: GoogleOAuthConfig | null;
    yandex: YandexOAuthConfig | null;
  };
}

/**
 * Google Calendar OAuth2 + REST v3 settings. `null` (unset client id/secret)
 * means the provider runs in demo/recording mode instead of hitting Google.
 */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  /** Calendar API base, e.g. https://www.googleapis.com/calendar/v3 */
  apiBase: string;
  /** OpenID userinfo endpoint (for the account label). */
  userinfoUrl: string;
  /** Space-separated OAuth scopes. */
  scope: string;
  /** Target calendar id to write into (default 'primary'). */
  calendarId: string;
}

/**
 * Yandex Calendar OAuth2 + CalDAV settings. `null` means demo/recording mode.
 * Yandex Calendar is a CalDAV service; we authenticate CalDAV requests with the
 * OAuth bearer token. The collection path is discovered from the userinfo login
 * unless CALDAV path overrides are supplied.
 */
export interface YandexOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  /** CalDAV base origin, e.g. https://caldav.yandex.ru */
  caldavBase: string;
  /** userinfo endpoint returning the account login/email. */
  userinfoUrl: string;
  scope: string;
  /**
   * CalDAV calendar collection path template. `{login}` is substituted with the
   * account login. Default matches Yandex's per-user events collection.
   */
  calendarPathTemplate: string;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_DEV_SECRET = 'dev-insecure-secret-change-me';

function buildGoogleConfig(env: NodeJS.ProcessEnv, publicBaseUrl: string): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  // A provider is only "live" when it has credentials; otherwise the app falls
  // back to the in-memory recording adapter so the demo and tests need no setup.
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: env.GOOGLE_REDIRECT_URI || `${publicBaseUrl}/api/calendar/oauth/google/callback`,
    authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    apiBase: env.GOOGLE_CALENDAR_API_BASE || 'https://www.googleapis.com/calendar/v3',
    userinfoUrl: env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo',
    scope:
      env.GOOGLE_SCOPE ||
      'https://www.googleapis.com/auth/calendar.events openid email',
    calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
  };
}

function buildYandexConfig(env: NodeJS.ProcessEnv, publicBaseUrl: string): YandexOAuthConfig | null {
  const clientId = env.YANDEX_CLIENT_ID;
  const clientSecret = env.YANDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: env.YANDEX_REDIRECT_URI || `${publicBaseUrl}/api/calendar/oauth/yandex/callback`,
    authUrl: env.YANDEX_AUTH_URL || 'https://oauth.yandex.com/authorize',
    tokenUrl: env.YANDEX_TOKEN_URL || 'https://oauth.yandex.com/token',
    caldavBase: env.YANDEX_CALDAV_BASE || 'https://caldav.yandex.ru',
    userinfoUrl: env.YANDEX_USERINFO_URL || 'https://login.yandex.ru/info',
    scope: env.YANDEX_SCOPE || 'login:email calendar:all',
    calendarPathTemplate: env.YANDEX_CALDAV_PATH_TEMPLATE || '/calendars/{login}/events-default/',
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET || DEFAULT_DEV_SECRET;

  // Security hard-fail: never boot a production process with the shipped dev
  // secret. Doing so would let anyone forge tokens (and thus any role). This is
  // deliberately fatal rather than a warning.
  if (isProduction && jwtSecret === DEFAULT_DEV_SECRET) {
    throw new Error(
      'Refusing to start: JWT_SECRET is unset or uses the insecure default in production. ' +
        'Set JWT_SECRET to a strong random value.',
    );
  }

  const port = num(env.PORT, 4000);
  const publicBaseUrl = (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

  return {
    host: env.HOST || '127.0.0.1',
    port,
    jwtSecret,
    jwtTtl: num(env.JWT_TTL, 60 * 60 * 24 * 7),
    dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'app.db'),
    reminderOffsets: (env.REMINDER_OFFSETS || '7,3,1')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x)),
    poolLeadDays: num(env.POOL_LEAD_DAYS, 14),
    poolDefaultTarget: num(env.POOL_DEFAULT_TARGET, 100),
    enableScheduler: env.ENABLE_SCHEDULER !== '0',
    schedulerIntervalMs: num(env.SCHEDULER_INTERVAL_MS, 60 * 60 * 1000),
    webDist: env.WEB_DIST || null,
    corsOrigins: (env.CORS_ORIGINS || '')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0),
    isProduction,
    rateLimit: {
      windowMs: num(env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
      max: num(env.RATE_LIMIT_MAX, 300),
      authMax: num(env.RATE_LIMIT_AUTH_MAX, 10),
    },
    publicBaseUrl,
    calendar: {
      google: buildGoogleConfig(env, publicBaseUrl),
      yandex: buildYandexConfig(env, publicBaseUrl),
    },
  };
}
