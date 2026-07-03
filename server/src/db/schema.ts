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
  balance       REAL NOT NULL DEFAULT 0,    -- account wallet balance
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('TOPUP','CONTRIBUTION','ADMIN_ADJUST','REFUND')),
  amount     REAL NOT NULL,                 -- signed: + credits, - debits
  balance_after REAL NOT NULL,
  memo       TEXT NOT NULL DEFAULT '',
  tx_ref     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_connections (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('google','yandex')),
  account_label TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider)
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

-- Explicit positive-authorization list for a secret chat. A row here is the
-- ONLY thing that grants read/post access to a room: "who is allowed" is this
-- allowlist, never "everyone who isn't the subject". The subject is excluded by
-- construction (they can never become eligible to join their own celebration).
--   role   — ORGANIZER (first to open the celebration) or PARTICIPANT
--   source — how they became eligible: a FRIEND subscription or a shared GROUP
CREATE TABLE IF NOT EXISTS chat_participants (
  room_id    TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'PARTICIPANT' CHECK (role IN ('ORGANIZER','PARTICIPANT')),
  source     TEXT NOT NULL DEFAULT 'FRIEND' CHECK (source IN ('FRIEND','GROUP')),
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id)
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
CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_contrib_pool ON pool_contributions(pool_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);
`;

/**
 * Additive migrations for databases created before a column existed. SQLite has
 * no `ADD COLUMN IF NOT EXISTS`, so we probe the table and add when missing.
 * Keeps older on-disk DBs working after an upgrade without a full re-seed.
 */
function applyMigrations(db: Db): void {
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
  if (!userCols.includes('balance')) {
    db.exec('ALTER TABLE users ADD COLUMN balance REAL NOT NULL DEFAULT 0');
  }
}

let singleton: Db | null = null;

/** Open (or create) the database and apply the schema. */
export function openDatabase(dbFile: string): Db {
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  // In WAL mode NORMAL is crash-safe (only an OS-level power loss can drop the
  // last transaction) and avoids an fsync on every commit, which materially
  // speeds up write-heavy paths like chat fan-out.
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  applyMigrations(db);
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
