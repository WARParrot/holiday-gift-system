import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { hashPassword } from '../src/util/auth.js';
import { randomUUID } from 'node:crypto';
import type { UserRow } from '../src/types/domain.js';

function mkUser(email: string, balance = 0): UserRow {
  return {
    id: randomUUID(), email, passwordHash: hashPassword('password'),
    fullName: email, birthdate: '1990-01-01', avatarUrl: null, role: 'USER', balance,
    createdAt: new Date().toISOString(),
  };
}

test('wallet credits and debits move balance and record a signed ledger', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const u = mkUser('w@x.com', 0);
  repo.createUser(u);

  const credit = repo.applyWalletTransaction({ id: randomUUID(), userId: u.id, kind: 'TOPUP', amount: 100, txRef: 'T1' });
  assert.ok(credit);
  assert.equal(credit!.balanceAfter, 100);
  assert.equal(repo.getBalance(u.id), 100);

  const debit = repo.applyWalletTransaction({ id: randomUUID(), userId: u.id, kind: 'CONTRIBUTION', amount: -30, txRef: 'T2' });
  assert.equal(debit!.balanceAfter, 70);

  const ledger = repo.listWalletTransactions(u.id);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].amount, -30); // newest first
});

test('wallet refuses an overdrawing debit but allows admin negative adjust', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const u = mkUser('w@x.com', 10);
  repo.createUser(u);

  const refused = repo.applyWalletTransaction({ id: randomUUID(), userId: u.id, kind: 'CONTRIBUTION', amount: -50, txRef: 'T1' });
  assert.equal(refused, null, 'overdraw must be refused');
  assert.equal(repo.getBalance(u.id), 10, 'balance unchanged after refused debit');

  const adminAdjust = repo.applyWalletTransaction({ id: randomUUID(), userId: u.id, kind: 'ADMIN_ADJUST', amount: -50, txRef: 'A1', allowNegative: true });
  assert.ok(adminAdjust);
  assert.equal(adminAdjust!.balanceAfter, -40, 'admin adjust may go negative');
});

test('calendar connections upsert and disconnect', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const u = mkUser('c@x.com');
  repo.createUser(u);

  repo.connectCalendar(u.id, 'google', 'me@gmail.com');
  repo.connectCalendar(u.id, 'yandex', 'me@yandex.ru');
  assert.equal(repo.listCalendarConnections(u.id).length, 2);

  // Re-connecting the same provider updates, not duplicates.
  repo.connectCalendar(u.id, 'google', 'other@gmail.com');
  const conns = repo.listCalendarConnections(u.id);
  assert.equal(conns.length, 2);
  assert.equal(conns.find((c) => c.provider === 'google')!.accountLabel, 'other@gmail.com');

  repo.disconnectCalendar(u.id, 'google');
  assert.equal(repo.listCalendarConnections(u.id).length, 1);
});

test('admin pool finance update sets balance/target/status directly', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('s@x.com');
  repo.createUser(subject);
  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());
  const poolId = randomUUID();
  repo.createPool({ id: poolId, subjectId: subject.id, subjectName: 'S', roomId: room.id, targetAmount: 100, currentBalance: 0, status: 'OPEN', openedAt: '', cycleKey: `${subject.id}:2099` });

  const updated = repo.updatePoolFinance(poolId, { targetAmount: 200, currentBalance: 75, status: 'OPEN' });
  assert.equal(updated!.targetAmount, 200);
  assert.equal(updated!.currentBalance, 75);
  assert.equal(repo.listAllPools().length, 1);
});
