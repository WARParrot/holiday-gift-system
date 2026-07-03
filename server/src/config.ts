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
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST || '127.0.0.1',
    port: num(env.PORT, 4000),
    jwtSecret: env.JWT_SECRET || 'dev-insecure-secret-change-me',
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
  };
}
