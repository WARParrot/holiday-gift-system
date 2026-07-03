import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { openDatabase } from './schema.js';
import { Repository } from './repository.js';
import { hashPassword } from '../util/auth.js';
import type { Group, UserRow } from '../types/domain.js';

/**
 * Create the schema and seed a realistic demo dataset. Safe to re-run: it
 * clears existing rows first (idempotent seed for local/dev use).
 *
 * Birthdates are generated relative to "today" so the reminder/pool scheduler
 * has something to fire on immediately in a demo:
 *   - carol: birthday in 1 day   (fires the 1-day reminder)
 *   - dave:  birthday in 7 days   (fires the 7-day reminder)
 *   - erin:  birthday in 14 days  (auto-opens a crowdfunding pool)
 */
function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function main(): void {
  const config = loadConfig();
  if (config.dbFile !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
    // Fresh start for the seed.
    for (const suffix of ['', '-wal', '-shm']) {
      const f = config.dbFile + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  }

  const db = openDatabase(config.dbFile);
  const repo = new Repository(db);

  const pw = hashPassword('password');
  const mkUser = (email: string, fullName: string, birthdate: string, role: UserRow['role'] = 'USER'): UserRow => ({
    id: randomUUID(),
    email,
    passwordHash: pw,
    fullName,
    birthdate,
    avatarUrl: null,
    role,
    createdAt: new Date().toISOString(),
  });

  const alice = mkUser('alice@example.com', 'Alice Andersson', '1996-05-12');
  const bob = mkUser('bob@example.com', 'Bob Brown', '1994-11-03');
  const carol = mkUser('carol@example.com', 'Carol Chen', isoInDays(1));
  const dave = mkUser('dave@example.com', 'Dave Diaz', isoInDays(7));
  const erin = mkUser('erin@example.com', 'Erin Eriksson', isoInDays(14));
  const admin = mkUser('admin@example.com', 'Admin User', '1990-01-01', 'ADMIN');
  const users = [alice, bob, carol, dave, erin, admin];
  for (const u of users) repo.createUser(u);

  const tseu: Group = {
    id: randomUUID(),
    name: 'TSEU Group 972501',
    description: 'University study group.',
    visibility: 'PUBLIC',
    ownerId: alice.id,
    createdAt: new Date().toISOString(),
  };
  const volleyball: Group = {
    id: randomUUID(),
    name: 'Volleyball Team',
    description: 'Weekend volleyball crew.',
    visibility: 'PUBLIC',
    ownerId: bob.id,
    createdAt: new Date().toISOString(),
  };
  repo.createGroup(tseu);
  repo.createGroup(volleyball);

  repo.addMember(tseu.id, alice.id);
  repo.addMember(tseu.id, carol.id);
  repo.addMember(tseu.id, dave.id);
  repo.addMember(volleyball.id, bob.id);
  repo.addMember(volleyball.id, carol.id);
  repo.addMember(volleyball.id, erin.id);

  // Wishlists
  repo.createWishlistItem({
    id: randomUUID(), ownerId: carol.id, title: 'Mechanical keyboard',
    description: 'Prefer brown switches, TKL layout.', link: 'https://example.com/keyboard',
    priceMin: 80, priceMax: 150, status: 'OPEN', createdAt: new Date().toISOString(),
  });
  repo.createWishlistItem({
    id: randomUUID(), ownerId: carol.id, title: 'Board game: Wingspan',
    description: 'The base game is fine.', link: null,
    priceMin: 40, priceMax: 60, status: 'OPEN', createdAt: new Date().toISOString(),
  });
  repo.createWishlistItem({
    id: randomUUID(), ownerId: dave.id, title: 'Running shoes',
    description: 'Size 44, road running.', link: null,
    priceMin: 100, priceMax: 180, status: 'OPEN', createdAt: new Date().toISOString(),
  });

  // Subscriptions: alice tracks carol (friend) and the whole volleyball team.
  repo.upsertSubscription({
    id: randomUUID(), subscriberId: alice.id, kind: 'FRIEND', targetId: carol.id,
    calendarSync: true, createdAt: new Date().toISOString(),
  });
  repo.upsertSubscription({
    id: randomUUID(), subscriberId: alice.id, kind: 'GROUP', targetId: volleyball.id,
    calendarSync: false, createdAt: new Date().toISOString(),
  });
  repo.upsertSubscription({
    id: randomUUID(), subscriberId: bob.id, kind: 'GROUP', targetId: tseu.id,
    calendarSync: false, createdAt: new Date().toISOString(),
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded ${users.length} users, 2 groups, wishlists and subscriptions at ${config.dbFile}`);
  // eslint-disable-next-line no-console
  console.log('Logins: alice@ / bob@ / carol@ / dave@ / erin@ / admin@example.com  (password: "password")');
}

main();
