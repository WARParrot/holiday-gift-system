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
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_DEV_SECRET = 'dev-insecure-secret-change-me';

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

  return {
    host: env.HOST || '127.0.0.1',
    port: num(env.PORT, 4000),
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
  };
}
