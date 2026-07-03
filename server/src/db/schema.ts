import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';

/**
 * The full relational schema. SQLite is used as the RDBMS: it is a real
 * SQL relational engine with foreign keys, transactions and constraints,
 * and needs zero external services to run — ideal for a self-contained,
 * reproducible deliverable. The SQL below is standard and ports cleanly to
 * Postgres/MySQL (only the autoincrement/`TEXT` id choices differ).
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  birthdate     TEXT NOT NULL,              -- YYYY-MM-DD
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ADMIN')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC','INVITE')),
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  link        TEXT,
  price_min   REAL,
  price_max   REAL,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SUGGESTED','RESERVED')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('FRIEND','GROUP')),
  target_id     TEXT NOT NULL,
  calendar_sync INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subscriber_id, kind, target_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  data       TEXT NOT NULL DEFAULT '{}',    -- JSON blob
  read       INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,                           -- prevents duplicate reminders
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS chat_rooms (
  id         TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crowdfunding_pools (
  id             TEXT PRIMARY KEY,
  subject_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id        TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  target_amount  REAL NOT NULL,
  current_balance REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  cycle_key      TEXT NOT NULL,             -- e.g. "<subjectId>:2026" ensures 1 pool per birthday cycle
  opened_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cycle_key)
);

CREATE TABLE IF NOT EXISTS pool_contributions (
  id             TEXT PRIMARY KEY,
  pool_id        TEXT NOT NULL REFERENCES crowdfunding_pools(id) ON DELETE CASCADE,
  contributor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         REAL NOT NULL,
  tx_ref         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_owner ON wishlist_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON subscriptions(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_contrib_pool ON pool_contributions(pool_id);
`;

let singleton: Db | null = null;

/** Open (or create) the database and apply the schema. */
export function openDatabase(dbFile: string): Db {
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

/** Process-wide singleton used by the running server. */
export function getDb(dbFile: string): Db {
  if (!singleton) singleton = openDatabase(dbFile);
  return singleton;
}

export function setDbForTests(db: Db): void {
  singleton = db;
}
