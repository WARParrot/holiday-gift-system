import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { canAccessRoom, canAccessSubjectChat } from '../src/services/chatAccess.js';
import { hashPassword } from '../src/util/auth.js';
import { randomUUID } from 'node:crypto';
import type { UserRow } from '../src/types/domain.js';

function mkUser(email: string, name: string, birthdate: string): UserRow {
  return {
    id: randomUUID(),
    email,
    passwordHash: hashPassword('password'),
    fullName: name,
    birthdate,
    avatarUrl: null,
    role: 'USER',
    createdAt: new Date().toISOString(),
  };
}

test('secret chat: the birthday subject is excluded from their own room', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject', '2000-01-01');
  const planner = mkUser('plan@x.com', 'Planner', '1999-02-02');
  repo.createUser(subject);
  repo.createUser(planner);

  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());

  // Subject is denied both by subject-id check and by room lookup.
  assert.equal(canAccessSubjectChat(subject.id, subject.id).allowed, false);
  assert.equal(canAccessSubjectChat(subject.id, subject.id).reason, 'IS_SUBJECT');
  assert.equal(canAccessRoom(repo, room.id, subject.id).allowed, false);

  // A different user (the planner) is allowed.
  assert.equal(canAccessRoom(repo, room.id, planner.id).allowed, true);
});

test('subscriberIdsForSubject never includes the subject themselves', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject', '2000-01-01');
  const a = mkUser('a@x.com', 'A', '1999-02-02');
  repo.createUser(subject);
  repo.createUser(a);

  // Subject tries to subscribe to their own group; must be filtered out.
  const groupId = randomUUID();
  repo.createGroup({ id: groupId, name: 'G', description: '', visibility: 'PUBLIC', ownerId: a.id, createdAt: '' });
  repo.addMember(groupId, subject.id);
  repo.addMember(groupId, a.id);
  repo.upsertSubscription({ id: randomUUID(), subscriberId: subject.id, kind: 'GROUP', targetId: groupId, calendarSync: false, createdAt: '' });
  repo.upsertSubscription({ id: randomUUID(), subscriberId: a.id, kind: 'FRIEND', targetId: subject.id, calendarSync: false, createdAt: '' });

  const subscribers = repo.subscriberIdsForSubject(subject.id);
  assert.ok(subscribers.includes(a.id));
  assert.ok(!subscribers.includes(subject.id));
});
