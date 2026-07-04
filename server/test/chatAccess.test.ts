import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { canAccessRoom, checkEligibility, isSubject } from '../src/services/chatAccess.js';
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
    balance: 0,
    createdAt: new Date().toISOString(),
  };
}

/** Give `subscriber` a FRIEND subscription to `subject`. */
function subscribeFriend(repo: Repository, subscriberId: string, subjectId: string): void {
  repo.sendFriendRequest(subscriberId, subjectId);
  repo.acceptFriendRequest(subjectId, subscriberId);
  repo.upsertSubscription({
    id: randomUUID(),
    subscriberId,
    kind: 'FRIEND',
    targetId: subjectId,
    calendarSync: false,
    createdAt: new Date().toISOString(),
  });
}

test('the birthday subject is excluded from their own room (hard invariant)', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject', '2000-01-01');
  const planner = mkUser('plan@x.com', 'Planner', '1999-02-02');
  repo.createUser(subject);
  repo.createUser(planner);

  assert.equal(isSubject(subject.id, subject.id), true);

  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());
  // Even if (defensively) the subject somehow held a participant row, access is denied.
  repo.addParticipant(room.id, subject.id, 'PARTICIPANT', 'FRIEND');
  const decision = canAccessRoom(repo, room.id, subject.id);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'IS_SUBJECT');
});

test('positive authorization: a non-subject needs an explicit participant grant', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject', '2000-01-01');
  const planner = mkUser('plan@x.com', 'Planner', '1999-02-02');
  repo.createUser(subject);
  repo.createUser(planner);
  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());

  // Before joining, a non-subject is NOT allowed — "not the subject" is not enough.
  const before = canAccessRoom(repo, room.id, planner.id);
  assert.equal(before.allowed, false);
  assert.equal(before.reason, 'NOT_A_PARTICIPANT');

  // After an explicit grant, access is allowed.
  repo.addParticipant(room.id, planner.id, 'ORGANIZER', 'FRIEND');
  assert.equal(canAccessRoom(repo, room.id, planner.id).allowed, true);
});

test('a stranger with no relationship is not eligible to join (regression: negative-access)', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject', '2000-01-01');
  const stranger = mkUser('stranger@x.com', 'Stranger', '1998-03-03');
  const friend = mkUser('friend@x.com', 'Friend', '1997-04-04');
  [subject, stranger, friend].forEach((u) => repo.createUser(u));

  // A stranger (no FRIEND/GROUP subscription to the subject) is NOT eligible.
  const strangerElig = checkEligibility(repo, subject.id, stranger.id);
  assert.equal(strangerElig.eligible, false);
  assert.equal(strangerElig.reason, 'NOT_ELIGIBLE');

  // A friend who subscribes IS eligible, with source FRIEND.
  subscribeFriend(repo, friend.id, subject.id);
  const friendElig = checkEligibility(repo, subject.id, friend.id);
  assert.equal(friendElig.eligible, true);
  assert.equal(friendElig.source, 'FRIEND');

  // The subject is never eligible for their own chat.
  const subjElig = checkEligibility(repo, subject.id, subject.id);
  assert.equal(subjElig.eligible, false);
  assert.equal(subjElig.reason, 'IS_SUBJECT');
});

test('eligibility can be granted via a shared group subscription (source GROUP)', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject', '2000-01-01');
  const member = mkUser('member@x.com', 'Member', '1996-05-05');
  [subject, member].forEach((u) => repo.createUser(u));

  const groupId = randomUUID();
  repo.createGroup({ id: groupId, name: 'G', description: '', visibility: 'PUBLIC', ownerId: member.id, createdAt: '' });
  repo.addMember(groupId, subject.id);
  // `member` subscribes to the whole group (which contains the subject).
  repo.upsertSubscription({ id: randomUUID(), subscriberId: member.id, kind: 'GROUP', targetId: groupId, calendarSync: false, createdAt: '' });

  const elig = checkEligibility(repo, subject.id, member.id);
  assert.equal(elig.eligible, true);
  assert.equal(elig.source, 'GROUP');
});

test('canAccessRoom returns ROOM_NOT_FOUND for an unknown room', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const u = mkUser('u@x.com', 'U', '2000-01-01');
  repo.createUser(u);
  const decision = canAccessRoom(repo, randomUUID(), u.id);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'ROOM_NOT_FOUND');
});

test('subscriberIdsForSubject never includes the subject themselves', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject', '2000-01-01');
  const a = mkUser('a@x.com', 'A', '1999-02-02');
  repo.createUser(subject);
  repo.createUser(a);

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
