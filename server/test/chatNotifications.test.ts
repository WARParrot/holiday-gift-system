import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { NotificationService } from '../src/services/notifications.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/util/auth.js';
import type { ChatMessage, ChatRoom, Notification, UserRow } from '../src/types/domain.js';

function mkUser(email: string, name: string): UserRow {
  return {
    id: randomUUID(),
    email,
    passwordHash: hashPassword('password'),
    fullName: name,
    birthdate: '2000-01-01',
    avatarUrl: null,
    role: 'USER',
    createdAt: new Date().toISOString(),
  };
}

function mkMessage(room: ChatRoom, author: UserRow, body: string): ChatMessage {
  return {
    id: randomUUID(),
    roomId: room.id,
    authorId: author.id,
    authorName: author.fullName,
    body,
    createdAt: new Date().toISOString(),
  };
}

test('chat notifications collapse into a single per-room counter', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject');
  const recipient = mkUser('rec@x.com', 'Recipient');
  const author = mkUser('auth@x.com', 'Author');
  [subject, recipient, author].forEach((u) => repo.createUser(u));
  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());

  const pushed: Notification[] = [];
  const service = new NotificationService(repo, loadConfig(), (_userId, n) => pushed.push(n));

  // Three messages arrive → one notification row, counter reaches 3.
  for (let i = 1; i <= 3; i += 1) {
    service.pushChatMessage(recipient.id, room, mkMessage(room, author, `msg ${i}`));
  }

  const list = repo.listNotifications(recipient.id).filter((n) => n.type === 'CHAT_MESSAGE');
  assert.equal(list.length, 1, 'exactly one collapsed notification');
  assert.equal(list[0].data.count, 3);
  assert.match(list[0].title, /3 новых сообщений/);
  assert.equal(list[0].read, false);

  // The live sink fired once per message (create + two bumps).
  assert.equal(pushed.length, 3);
  assert.equal(pushed[2].id, list[0].id, 'bump reuses the same notification id');
});

test('posting in a chat clears the author’s own counter notification (req 2)', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject');
  const author = mkUser('auth@x.com', 'Author');
  const other = mkUser('other@x.com', 'Other');
  [subject, author, other].forEach((u) => repo.createUser(u));
  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());

  const service = new NotificationService(repo, loadConfig());
  // The author had accumulated a counter (e.g. from `other`'s messages).
  service.pushChatMessage(author.id, room, mkMessage(room, other, 'earlier'));
  assert.equal(repo.findNotificationByDedupe(author.id, `chat:${room.id}`)?.data.count, 1);

  // Author posts → their counter for this room is removed (what the hub does).
  const removed = repo.deleteNotificationByDedupe(author.id, `chat:${room.id}`);
  assert.ok(removed, 'a notification id was returned');
  assert.equal(repo.findNotificationByDedupe(author.id, `chat:${room.id}`), undefined);
});

test('only subscribers of the subject are notified (req 3)', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject');
  const subscriber = mkUser('friend@x.com', 'Subscriber');
  const bystander = mkUser('by@x.com', 'Bystander');
  [subject, subscriber, bystander].forEach((u) => repo.createUser(u));

  // Only `subscriber` is friends with and subscribes to the subject's birthday; `bystander` does not.
  repo.sendFriendRequest(subscriber.id, subject.id);
  repo.acceptFriendRequest(subject.id, subscriber.id);
  repo.upsertSubscription({
    id: randomUUID(),
    subscriberId: subscriber.id,
    kind: 'FRIEND',
    targetId: subject.id,
    calendarSync: false,
    createdAt: '',
  });

  const recipients = repo.subscriberIdsForSubject(subject.id);
  assert.deepEqual(recipients, [subscriber.id]);
  assert.ok(!recipients.includes(bystander.id));
  assert.ok(!recipients.includes(subject.id));
});

test('reading a chat notification resets the counter on the next message', () => {
  const repo = new Repository(openDatabase(':memory:'));
  const subject = mkUser('sub@x.com', 'Subject');
  const recipient = mkUser('rec@x.com', 'Recipient');
  const author = mkUser('auth@x.com', 'Author');
  [subject, recipient, author].forEach((u) => repo.createUser(u));
  const room = repo.getOrCreateRoomForSubject(subject.id, randomUUID());

  const service = new NotificationService(repo, loadConfig());

  service.pushChatMessage(recipient.id, room, mkMessage(room, author, 'a'));
  service.pushChatMessage(recipient.id, room, mkMessage(room, author, 'b'));

  const before = repo.listNotifications(recipient.id)[0];
  assert.equal(before.data.count, 2);

  // Recipient reads it, then a new message arrives → count restarts at 1.
  repo.markNotificationRead(before.id, recipient.id);
  service.pushChatMessage(recipient.id, room, mkMessage(room, author, 'c'));

  const after = repo.listNotifications(recipient.id);
  assert.equal(after.length, 1, 'still a single row (same dedupe key)');
  assert.equal(after[0].data.count, 1);
  assert.equal(after[0].read, false);
  assert.match(after[0].title, /Новое сообщение/);
});
