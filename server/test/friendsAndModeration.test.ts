import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { hashPassword } from '../src/util/auth.js';
import type { UserRow } from '../src/types/domain.js';

function mkUser(email: string, name: string): UserRow {
  return {
    id: randomUUID(), email, passwordHash: hashPassword('password'), fullName: name,
    birthdate: '1990-01-01', avatarUrl: null, role: 'USER', balance: 0,
    createdAt: new Date().toISOString(),
  };
}

test('friendships: request, accept, list, and remove', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const a = mkUser('a@x.com', 'A');
  const b = mkUser('b@x.com', 'B');
  [a, b].forEach((u) => repo.createUser(u));

  assert.equal(repo.areFriends(a.id, b.id), false);
  assert.equal(repo.sendFriendRequest(a.id, b.id), 'sent');
  assert.equal(repo.friendState(a.id, b.id), 'pending_outgoing');
  assert.equal(repo.friendState(b.id, a.id), 'pending_incoming');
  assert.deepEqual(repo.listIncomingRequests(b.id).map((u) => u.id), [a.id]);

  assert.equal(repo.acceptFriendRequest(b.id, a.id), true);
  assert.equal(repo.areFriends(a.id, b.id), true);
  assert.deepEqual(repo.listFriends(a.id).map((u) => u.id), [b.id]);

  repo.removeFriendship(a.id, b.id);
  assert.equal(repo.areFriends(a.id, b.id), false);
});

test('friendships: reciprocal request auto-accepts existing pending request', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const a = mkUser('a2@x.com', 'A');
  const b = mkUser('b2@x.com', 'B');
  [a, b].forEach((u) => repo.createUser(u));
  repo.sendFriendRequest(a.id, b.id);
  assert.equal(repo.sendFriendRequest(b.id, a.id), 'accepted_existing');
  assert.equal(repo.areFriends(a.id, b.id), true);
});

test('friendships gate FRIEND-subscription chat eligibility', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subscriber = mkUser('s@x.com', 'Sub');
  const subject = mkUser('t@x.com', 'Subject');
  [subscriber, subject].forEach((u) => repo.createUser(u));

  repo.upsertSubscription({ id: randomUUID(), subscriberId: subscriber.id, kind: 'FRIEND', targetId: subject.id, calendarSync: false, createdAt: '' });
  assert.equal(repo.subscriptionSourceFor(subscriber.id, subject.id), null);

  repo.sendFriendRequest(subscriber.id, subject.id);
  repo.acceptFriendRequest(subject.id, subscriber.id);
  assert.equal(repo.subscriptionSourceFor(subscriber.id, subject.id), 'FRIEND');

  repo.removeFriendship(subscriber.id, subject.id);
  assert.equal(repo.subscriptionSourceFor(subscriber.id, subject.id), null);
});

test('group helpers support no-orphan leave behavior', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const owner = mkUser('o@x.com', 'Owner');
  const other = mkUser('m@x.com', 'Member');
  [owner, other].forEach((u) => repo.createUser(u));

  const gid = randomUUID();
  repo.createGroup({ id: gid, name: 'G', description: '', visibility: 'INVITE', ownerId: owner.id, createdAt: '' });
  repo.addMember(gid, owner.id);
  repo.addMember(gid, other.id);
  assert.equal(repo.countGroupMembers(gid), 2);

  repo.removeMember(gid, owner.id);
  const remaining = repo.memberIdsOfGroup(gid);
  repo.setGroupOwner(gid, remaining[0]);
  assert.equal(repo.getGroup(gid)!.ownerId, other.id);

  repo.removeMember(gid, other.id);
  assert.equal(repo.countGroupMembers(gid), 0);
  repo.deleteGroup(gid);
  assert.equal(repo.getGroup(gid), undefined);
});

test('message CRUD: update changes body and delete removes message', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('subj@x.com', 'Subject');
  const author = mkUser('auth@x.com', 'Author');
  [subject, author].forEach((u) => repo.createUser(u));
  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());
  const msg = repo.addMessage({ id: randomUUID(), roomId: room.id, authorId: author.id, body: 'original' });

  assert.equal(repo.updateMessage(msg.id, 'edited')!.body, 'edited');
  assert.equal(repo.getMessage(msg.id)!.body, 'edited');
  assert.equal(repo.deleteMessage(msg.id), true);
  assert.equal(repo.getMessage(msg.id), undefined);
  assert.equal(repo.deleteMessage(msg.id), false);
});
