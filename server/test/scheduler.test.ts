import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { NotificationService } from '../src/services/notifications.js';
import { hashPassword } from '../src/util/auth.js';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../src/config.js';
import type { UserRow } from '../src/types/domain.js';

function daysFromNowBirthdate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  // Birthdate in a past year, same month/day as the target upcoming date.
  return `1990-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function mkUser(email: string, name: string, birthdate: string): UserRow {
  return {
    id: randomUUID(), email, passwordHash: hashPassword('password'),
    fullName: name, birthdate, avatarUrl: null, role: 'USER', balance: 0, createdAt: new Date().toISOString(),
  };
}

const schedConfig: AppConfig = {
  host: '127.0.0.1', port: 0, jwtSecret: 'test', jwtTtl: 3600, dbFile: ':memory:',
  reminderOffsets: [7, 3, 1], poolLeadDays: 7, poolDefaultTarget: 100,
  enableScheduler: false, schedulerIntervalMs: 1000, webDist: null,
};

test('scheduler emits a reminder to subscribers and is idempotent across ticks', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject', daysFromNowBirthdate(7));
  const planner = mkUser('plan@x.com', 'Planner', '1990-05-05');
  repo.createUser(subject);
  repo.createUser(planner);
  repo.sendFriendRequest(planner.id, subject.id);
  repo.acceptFriendRequest(subject.id, planner.id);
  repo.upsertSubscription({ id: randomUUID(), subscriberId: planner.id, kind: 'FRIEND', targetId: subject.id, calendarSync: false, createdAt: '' });

  const svc = new NotificationService(repo, schedConfig);
  const first = svc.runTick();
  assert.ok(first.reminders >= 1);
  assert.ok(first.pools >= 1, 'pool should auto-open at the 7-day lead window');

  const before = repo.listNotifications(planner.id).length;
  const second = svc.runTick();
  assert.equal(second.reminders, 0, 'no duplicate reminders on a second tick');
  assert.equal(repo.listNotifications(planner.id).length, before, 'notification count stable');

  // Subject must not receive any notification about their own birthday.
  assert.equal(repo.listNotifications(subject.id).length, 0);
});
