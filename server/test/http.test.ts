import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { buildApp } from '../src/app.js';
import { ChatHub } from '../src/ws/chatHub.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { hashPassword, signToken } from '../src/util/auth.js';
import type { UserRow } from '../src/types/domain.js';

/**
 * HTTP-layer tests: exercise the real Express app end-to-end (auth, the secret
 * chat's positive-authorization model, REST/WS notify parity, and the
 * deleted-user token regression) rather than only the pure access function.
 */
interface Harness {
  server: Server;
  base: string;
  repo: Repository;
  config: AppConfig;
  close: () => Promise<void>;
}

function mkUser(email: string, name: string, birthdate = '1990-06-15', balance = 0): UserRow {
  return {
    id: randomUUID(),
    email,
    passwordHash: hashPassword('password'),
    fullName: name,
    birthdate,
    avatarUrl: null,
    role: 'USER',
    balance,
    createdAt: new Date().toISOString(),
  };
}

async function harness(): Promise<Harness> {
  const config = loadConfig({ DB_FILE: ':memory:', ENABLE_SCHEDULER: '0', RATE_LIMIT_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' } as NodeJS.ProcessEnv);
  const repo = new Repository(openDatabase(':memory:'));
  const { app, ctx } = buildApp(config, repo);
  const server = createServer(app);
  // Attach the ChatHub exactly as production does so REST-path side effects
  // (notification fan-out via ctx.hub.current) are exercised end-to-end.
  const hub = new ChatHub(server, repo, config, ctx.notifications);
  ctx.hub.current = hub;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    repo,
    config,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function token(h: Harness, user: UserRow): string {
  return signToken({ userId: user.id, role: user.role }, h.config.jwtSecret, h.config.jwtTtl);
}

async function api(h: Harness, path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${h.base}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

test('HTTP: a stranger gets 403 joining a subject chat; an eligible friend gets 201', async () => {
  const h = await harness();
  try {
    const subject = mkUser('subj@x.com', 'Subject');
    const stranger = mkUser('stranger@x.com', 'Stranger');
    const friend = mkUser('friend@x.com', 'Friend');
    [subject, stranger, friend].forEach((u) => h.repo.createUser(u));
    // friend subscribes to subject → eligible.
    h.repo.sendFriendRequest(friend.id, subject.id);
    h.repo.acceptFriendRequest(subject.id, friend.id);
    h.repo.upsertSubscription({ id: randomUUID(), subscriberId: friend.id, kind: 'FRIEND', targetId: subject.id, calendarSync: false, createdAt: '' });

    // Stranger: no relationship → 403, and NO room is created as a side effect.
    const strangerJoin = await api(h, `/api/chat/subject/${subject.id}/room/join`, { method: 'POST', token: token(h, stranger) });
    assert.equal(strangerJoin.status, 403);
    assert.equal(h.repo.getRoomBySubject(subject.id), undefined, 'no room materialised by a denied join');

    // The subject themselves: 403.
    const subjectJoin = await api(h, `/api/chat/subject/${subject.id}/room/join`, { method: 'POST', token: token(h, subject) });
    assert.equal(subjectJoin.status, 403);

    // Friend: eligible → 201, room + organizer participant created.
    const friendJoin = await api(h, `/api/chat/subject/${subject.id}/room/join`, { method: 'POST', token: token(h, friend) });
    assert.equal(friendJoin.status, 201);
    const roomId = friendJoin.body.room.id as string;
    assert.ok(roomId);
    assert.equal(h.repo.isParticipant(roomId, friend.id), true);

    // Stranger still cannot read history for the now-existing room → 403.
    const strangerRead = await api(h, `/api/chat/rooms/${roomId}/messages`, { token: token(h, stranger) });
    assert.equal(strangerRead.status, 403);

    // Subject cannot read it either → 403 (IS_SUBJECT).
    const subjectRead = await api(h, `/api/chat/rooms/${roomId}/messages`, { token: token(h, subject) });
    assert.equal(subjectRead.status, 403);

    // Friend (participant) can read → 200.
    const friendRead = await api(h, `/api/chat/rooms/${roomId}/messages`, { token: token(h, friend) });
    assert.equal(friendRead.status, 200);
  } finally {
    await h.close();
  }
});

test('HTTP: GET friend card does NOT auto-create a room (no GET-side mutation)', async () => {
  const h = await harness();
  try {
    const subject = mkUser('subj@x.com', 'Subject');
    const friend = mkUser('friend@x.com', 'Friend');
    [subject, friend].forEach((u) => h.repo.createUser(u));
    h.repo.sendFriendRequest(friend.id, subject.id);
    h.repo.acceptFriendRequest(subject.id, friend.id);
    h.repo.upsertSubscription({ id: randomUUID(), subscriberId: friend.id, kind: 'FRIEND', targetId: subject.id, calendarSync: false, createdAt: '' });

    const card = await api(h, `/api/users/${subject.id}/card`, { token: token(h, friend) });
    assert.equal(card.status, 200);
    // Eligible but not yet joined → chat not visible, but flagged joinable.
    assert.equal(card.body.secretChat.visible, false);
    assert.equal(card.body.secretChat.eligible, true);
    // Crucially, merely viewing the card created no room.
    assert.equal(h.repo.getRoomBySubject(subject.id), undefined);
  } finally {
    await h.close();
  }
});

test('HTTP: a token for a deleted user is rejected (regression: delete-then-use)', async () => {
  const h = await harness();
  try {
    const user = mkUser('ghost@x.com', 'Ghost');
    h.repo.createUser(user);
    const t = token(h, user);

    // Works while the account exists.
    const before = await api(h, '/api/users/me', { token: t });
    assert.equal(before.status, 200);

    // Admin deletes the account; the still-valid JWT must stop working.
    h.repo.deleteUser(user.id);
    const after = await api(h, '/api/users/me', { token: t });
    assert.equal(after.status, 401);
  } finally {
    await h.close();
  }
});

test('HTTP: role is re-read from the DB, not trusted from the token', async () => {
  const h = await harness();
  try {
    const user = mkUser('promote@x.com', 'User');
    h.repo.createUser(user);
    // Token minted while USER; admin endpoint must be forbidden.
    const userToken = token(h, user);
    assert.equal((await api(h, '/api/admin/users', { token: userToken })).status, 403);

    // Promote in the DB; the SAME (stale) token now reflects ADMIN because the
    // middleware re-reads the role from the DB.
    h.repo.setUserRole(user.id, 'ADMIN');
    assert.equal((await api(h, '/api/admin/users', { token: userToken })).status, 200);
  } finally {
    await h.close();
  }
});

test('HTTP: REST-sent chat message notifies subscribers (WS/REST parity)', async () => {
  const h = await harness();
  try {
    const subject = mkUser('subj@x.com', 'Subject');
    const organizer = mkUser('org@x.com', 'Organizer');
    const subscriber = mkUser('sub@x.com', 'Subscriber');
    [subject, organizer, subscriber].forEach((u) => h.repo.createUser(u));
    // Both organizer and subscriber subscribe to the subject.
    for (const u of [organizer, subscriber]) {
      h.repo.sendFriendRequest(u.id, subject.id);
      h.repo.acceptFriendRequest(subject.id, u.id);
      h.repo.upsertSubscription({ id: randomUUID(), subscriberId: u.id, kind: 'FRIEND', targetId: subject.id, calendarSync: false, createdAt: '' });
    }

    const join = await api(h, `/api/chat/subject/${subject.id}/room/join`, { method: 'POST', token: token(h, organizer) });
    const roomId = join.body.room.id as string;

    // Organizer sends a message via the REST endpoint.
    const send = await api(h, `/api/chat/rooms/${roomId}/messages`, { method: 'POST', token: token(h, organizer), body: { body: 'hello team' } });
    assert.equal(send.status, 201);

    // The subscriber notification fan-out runs on setImmediate; wait a tick.
    await new Promise((r) => setTimeout(r, 50));

    const subNotifs = h.repo.listNotifications(subscriber.id).filter((n) => n.type === 'CHAT_MESSAGE');
    assert.equal(subNotifs.length, 1, 'REST-sent message notified the subscriber');
    // The author is not notified about their own message.
    const authorNotifs = h.repo.listNotifications(organizer.id).filter((n) => n.type === 'CHAT_MESSAGE');
    assert.equal(authorNotifs.length, 0);
  } finally {
    await h.close();
  }
});

test('HTTP: message history paginates with limit + before cursor', async () => {
  const h = await harness();
  try {
    const subject = mkUser('subj@x.com', 'Subject');
    const organizer = mkUser('org@x.com', 'Organizer');
    [subject, organizer].forEach((u) => h.repo.createUser(u));
    h.repo.sendFriendRequest(organizer.id, subject.id);
    h.repo.acceptFriendRequest(subject.id, organizer.id);
    h.repo.upsertSubscription({ id: randomUUID(), subscriberId: organizer.id, kind: 'FRIEND', targetId: subject.id, calendarSync: false, createdAt: '' });
    const join = await api(h, `/api/chat/subject/${subject.id}/room/join`, { method: 'POST', token: token(h, organizer) });
    const roomId = join.body.room.id as string;

    // Insert 5 messages.
    for (let i = 0; i < 5; i += 1) {
      h.repo.addMessage({ id: randomUUID(), roomId, authorId: organizer.id, body: `m${i}` });
    }

    const page1 = await api(h, `/api/chat/rooms/${roomId}/messages?limit=2`, { token: token(h, organizer) });
    assert.equal(page1.status, 200);
    assert.equal(page1.body.messages.length, 2);
    assert.ok(page1.body.nextBefore, 'a cursor is returned when the page is full');

    const page2 = await api(h, `/api/chat/rooms/${roomId}/messages?limit=2&before=${encodeURIComponent(page1.body.nextBefore)}`, { token: token(h, organizer) });
    assert.equal(page2.status, 200);
    assert.ok(page2.body.messages.length >= 1);
  } finally {
    await h.close();
  }
});
