import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { processMockCharge } from '../src/services/mockBank.js';
import { hashPassword } from '../src/util/auth.js';
import { randomUUID } from 'node:crypto';
import type { UserRow } from '../src/types/domain.js';

function mkUser(email: string, name: string): UserRow {
  return {
    id: randomUUID(), email, passwordHash: hashPassword('password'),
    fullName: name, birthdate: '1990-01-01', avatarUrl: null, role: 'USER', balance: 0, createdAt: new Date().toISOString(),
  };
}

test('mock bank rejects invalid amounts and approves valid charges', () => {
  assert.equal(processMockCharge({ userId: 'u', amount: 0, targetAmount: 100, currentBalance: 0 }).ok, false);
  assert.equal(processMockCharge({ userId: 'u', amount: -5, targetAmount: 100, currentBalance: 0 }).ok, false);
  const ok = processMockCharge({ userId: 'u', amount: 25.5, targetAmount: 100, currentBalance: 0 });
  assert.equal(ok.ok, true);
  assert.equal(ok.processedAmount, 25.5);
  assert.match(ok.txRef, /^MOCK-/);
});

test('crowdfunding pool accumulates contributions transactionally', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject');
  const a = mkUser('a@x.com', 'A');
  const b = mkUser('b@x.com', 'B');
  [subject, a, b].forEach((u) => repo.createUser(u));

  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());
  const poolId = randomUUID();
  const created = repo.createPool({
    id: poolId, subjectId: subject.id, subjectName: subject.fullName, roomId: room.id,
    targetAmount: 100, currentBalance: 0, status: 'OPEN', openedAt: new Date().toISOString(),
    cycleKey: `${subject.id}:2026`,
  });
  assert.equal(created, true);

  repo.addContribution({ id: randomUUID(), poolId, contributorId: a.id, contributorName: '', amount: 30, txRef: 'MOCK-1', createdAt: '' });
  const afterSecond = repo.addContribution({ id: randomUUID(), poolId, contributorId: b.id, contributorName: '', amount: 45, txRef: 'MOCK-2', createdAt: '' });

  assert.equal(afterSecond.currentBalance, 75);
  assert.equal(repo.listContributions(poolId).length, 2);

  // Unique cycle key prevents a duplicate pool for the same birthday cycle.
  const dup = repo.createPool({
    id: randomUUID(), subjectId: subject.id, subjectName: subject.fullName, roomId: room.id,
    targetAmount: 100, currentBalance: 0, status: 'OPEN', openedAt: new Date().toISOString(),
    cycleKey: `${subject.id}:2026`,
  });
  assert.equal(dup, false);
});
