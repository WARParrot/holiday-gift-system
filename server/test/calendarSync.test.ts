import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { loadConfig } from '../src/config.js';
import { CalendarOAuthService } from '../src/services/calendarOAuth.js';
import { CalendarSyncService, YandexCalendarProvider } from '../src/services/calendarSync.js';
import { buildBirthdayIcs } from '../src/services/ics.js';
import { hashPassword } from '../src/util/auth.js';
import type { Subscription, UserRow } from '../src/types/domain.js';

/**
 * These tests exercise the REAL Google-REST and Yandex-CalDAV adapters against
 * throwaway in-process HTTP servers that speak the two protocols. No external
 * network, no credentials — but the adapters run their actual request-building,
 * idempotent-id, token-refresh, and ICS logic end to end.
 */

function mkUser(email: string, name: string, birthdate = '1990-06-15'): UserRow {
  return {
    id: randomUUID(), email, passwordHash: hashPassword('password'),
    fullName: name, birthdate, avatarUrl: null, role: 'USER', balance: 0,
    createdAt: new Date().toISOString(),
  };
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; base: string }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const sub = (subscriberId: string, targetId: string): Subscription => ({
  id: randomUUID(), subscriberId, kind: 'FRIEND', targetId, calendarSync: true, createdAt: '',
});

test('Google adapter: OAuth token exchange, refresh on expiry, and idempotent event upsert (real REST calls)', async () => {
  const googleCalls: { method: string; url: string; auth: string; body: string }[] = [];
  let tokenExchanges = 0;
  let refreshes = 0;
  const events = new Map<string, unknown>();

  const { server, base } = await listen(async (req, res) => {
    const url = req.url ?? '';
    const b = await body(req);
    if (url === '/token') {
      const params = new URLSearchParams(b);
      const grant = params.get('grant_type');
      if (grant === 'authorization_code') {
        tokenExchanges += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        // expires_in:1 → the stored token is immediately stale, forcing a refresh on sync.
        res.end(JSON.stringify({ access_token: 'ACCESS-1', refresh_token: 'REFRESH-1', token_type: 'Bearer', scope: 's', expires_in: 1 }));
        return;
      }
      if (grant === 'refresh_token') {
        refreshes += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'ACCESS-2', token_type: 'Bearer', expires_in: 3600 }));
        return;
      }
    }
    if (url === '/userinfo') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ email: 'planner@gmail.com', sub: 'g-123' }));
      return;
    }
    if (url.includes('/events/')) {
      googleCalls.push({ method: req.method ?? '', url, auth: req.headers.authorization ?? '', body: b });
      const id = url.split('/events/')[1].split('?')[0];
      if (req.method === 'PUT') {
        if (!events.has(id)) { res.writeHead(404); res.end('{}'); return; } // force insert path first time
        events.set(id, JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id })); return;
      }
      if (req.method === 'DELETE') { events.delete(id); res.writeHead(204); res.end(); return; }
    }
    if (url.endsWith('/events') && req.method === 'POST') {
      googleCalls.push({ method: 'POST', url, auth: req.headers.authorization ?? '', body: b });
      const parsed = JSON.parse(b) as { id: string };
      events.set(parsed.id, parsed);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(parsed)); return;
    }
    res.writeHead(500); res.end('unexpected');
  });

  try {
    const env = {
      DB_FILE: ':memory:', ENABLE_SCHEDULER: '0',
      GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_TOKEN_URL: `${base}/token`,
      GOOGLE_CALENDAR_API_BASE: base,
      GOOGLE_USERINFO_URL: `${base}/userinfo`,
    } as NodeJS.ProcessEnv;
    const config = loadConfig(env);
    assert.ok(config.calendar.google, 'google configured live');

    const repo = new Repository(openDatabase(':memory:'));
    const subscriber = mkUser('planner@x.com', 'Planner');
    const subject = mkUser('bday@x.com', 'Birthday Person', '1992-06-15');
    [subscriber, subject].forEach((u) => repo.createUser(u));

    const oauth = new CalendarOAuthService(config, repo);
    const sync = new CalendarSyncService({ repo, config, oauth });
    assert.equal(sync.isLive('google'), true);

    // Simulate the OAuth callback: exchange code, store token, connect.
    const tokens = await oauth.exchangeCode('google', 'auth-code');
    assert.equal(tokenExchanges, 1);
    const login = await oauth.fetchAccountLogin('google', tokens.accessToken);
    assert.equal(login, 'planner@gmail.com');
    repo.upsertCalendarToken({
      userId: subscriber.id, provider: 'google', accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken, tokenType: tokens.tokenType, scope: tokens.scope,
      accountLogin: login, expiresAt: tokens.expiresAt,
    });
    repo.connectCalendar(subscriber.id, 'google', login);

    // First sync: token is stale (expires_in:1) → adapter refreshes, then PUT 404 → POST insert.
    const pushed = await sync.syncSubjects(sub(subscriber.id, subject.id), [subject]);
    assert.equal(pushed.length, 1);
    assert.equal(refreshes, 1, 'expired token was refreshed');
    assert.ok(googleCalls.some((c) => c.method === 'POST'), 'inserted via POST when PUT 404');
    assert.ok(googleCalls.every((c) => c.auth === 'Bearer ACCESS-2'), 'used the refreshed token');

    // Second sync: event now exists → PUT updates in place (idempotent, no duplicate insert).
    const postsBefore = googleCalls.filter((c) => c.method === 'POST').length;
    await sync.syncSubjects(sub(subscriber.id, subject.id), [subject]);
    const postsAfter = googleCalls.filter((c) => c.method === 'POST').length;
    assert.equal(postsAfter, postsBefore, 'no new POST — PUT updated the existing event');
    assert.equal(events.size, 1, 'exactly one event, not duplicated');

    // Remove path.
    await sync.removeSubjects(sub(subscriber.id, subject.id), [subject]);
    assert.equal(events.size, 0, 'event deleted');
  } finally {
    server.close();
  }
});

test('Yandex adapter: CalDAV Basic-auth PUT of a valid VEVENT to a login-scoped href, idempotent DELETE', async () => {
  const caldav: { method: string; path: string; auth: string; contentType: string; body: string }[] = [];
  const store = new Map<string, string>();
  const EXPECTED_BASIC = `Basic ${Buffer.from('ivan@yandex.ru:app-pass-1234', 'utf8').toString('base64')}`;

  const { server, base } = await listen(async (req, res) => {
    const url = req.url ?? '';
    const b = await body(req);
    caldav.push({ method: req.method ?? '', path: url, auth: req.headers.authorization ?? '', contentType: req.headers['content-type'] ?? '', body: b });
    // Every CalDAV request must carry the Basic credential; reject otherwise.
    if (req.headers.authorization !== EXPECTED_BASIC) { res.writeHead(401); res.end(); return; }
    if (req.method === 'PROPFIND') { res.writeHead(207); res.end('<multistatus/>'); return; }
    if (req.method === 'PUT') { store.set(url, b); res.writeHead(201); res.end(); return; }
    if (req.method === 'DELETE') {
      if (store.has(url)) { store.delete(url); res.writeHead(204); res.end(); return; }
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(500); res.end('unexpected');
  });

  try {
    // Yandex is CalDAV + app-password (Basic auth), NOT OAuth — no client id/secret.
    const env = {
      DB_FILE: ':memory:', ENABLE_SCHEDULER: '0',
      YANDEX_CALDAV_ENABLED: '1',
      YANDEX_CALDAV_BASE: base,
      YANDEX_CALDAV_PATH_TEMPLATE: '/calendars/{login}/events-default/',
    } as NodeJS.ProcessEnv;
    const config = loadConfig(env);
    assert.ok(config.calendar.yandex, 'yandex configured live');

    const repo = new Repository(openDatabase(':memory:'));
    const subscriber = mkUser('me@x.com', 'Me');
    const subject = mkUser('friend@x.com', "Friend O'Brien, Jr.", '1988-02-29');
    [subscriber, subject].forEach((u) => repo.createUser(u));

    const oauth = new CalendarOAuthService(config, repo);
    const sync = new CalendarSyncService({ repo, config, oauth });
    assert.equal(sync.isLive('yandex'), true);

    // A wrong app password fails verification (401 → false); the right one verifies (207).
    assert.equal(await YandexCalendarProvider.verifyCredentials(config.calendar.yandex!, 'ivan@yandex.ru', 'WRONG'), false);
    assert.equal(await YandexCalendarProvider.verifyCredentials(config.calendar.yandex!, 'ivan@yandex.ru', 'app-pass-1234'), true);

    // Connect stores the app password as the credential (tokenType 'Basic').
    repo.upsertCalendarToken({
      userId: subscriber.id, provider: 'yandex', accessToken: 'app-pass-1234',
      refreshToken: '', tokenType: 'Basic', scope: 'caldav',
      accountLogin: 'ivan@yandex.ru', expiresAt: 0,
    });
    repo.connectCalendar(subscriber.id, 'yandex', 'ivan@yandex.ru');

    const pushed = await sync.syncSubjects(sub(subscriber.id, subject.id), [subject]);
    assert.equal(pushed.length, 1);

    const put = caldav.find((c) => c.method === 'PUT');
    assert.ok(put, 'a PUT was made');
    assert.equal(put!.auth, EXPECTED_BASIC, 'CalDAV PUT used Basic auth (login:app-password), not Bearer');
    assert.match(put!.contentType, /text\/calendar/);
    // href is scoped to the account login and ends with an .ics resource.
    assert.match(put!.path, /^\/calendars\/ivan%40yandex\.ru\/events-default\/.*\.ics$/);
    // Body is a real VCALENDAR/VEVENT with CRLF endings and escaped SUMMARY.
    assert.match(put!.body, /BEGIN:VCALENDAR\r\n/);
    assert.match(put!.body, /BEGIN:VEVENT\r\n/);
    assert.match(put!.body, /RRULE:FREQ=YEARLY/);
    assert.match(put!.body, /DTSTART;VALUE=DATE:19880229/);
    assert.match(put!.body, /SUMMARY:.*O'Brien\\, Jr\./, 'comma in name is escaped');

    // Idempotent delete (also Basic-authed).
    await sync.removeSubjects(sub(subscriber.id, subject.id), [subject]);
    assert.equal(store.size, 0, 'resource removed');
    await sync.removeSubjects(sub(subscriber.id, subject.id), [subject]);
  } finally {
    server.close();
  }
});

test('ICS builder folds long lines at <=75 octets and terminates with CRLF', () => {
  const longName = 'X'.repeat(200);
  const ics = buildBirthdayIcs({ uid: 'u1', summary: `🎂 ${longName}'s birthday`, rrule: 'FREQ=YEARLY', date: '2000-01-01' }, new Date('2026-01-01T00:00:00Z'));
  assert.ok(ics.endsWith('\r\n'));
  for (const line of ics.split('\r\n')) {
    // Continuation lines start with a space; every physical line <= 75 octets.
    assert.ok(Buffer.from(line, 'utf8').length <= 75, `line too long: ${line.length}`);
  }
  assert.match(ics, /DTSTAMP:20260101T000000Z/);
});

test('recording fallback: with no credentials the provider is not live and records events in-memory', async () => {
  const config = loadConfig({ DB_FILE: ':memory:', ENABLE_SCHEDULER: '0' } as NodeJS.ProcessEnv);
  assert.equal(config.calendar.google, null);
  assert.equal(config.calendar.yandex, null);

  const repo = new Repository(openDatabase(':memory:'));
  const subscriber = mkUser('a@x.com', 'A');
  const subject = mkUser('b@x.com', 'B');
  [subscriber, subject].forEach((u) => repo.createUser(u));
  const oauth = new CalendarOAuthService(config, repo);
  const sync = new CalendarSyncService({ repo, config, oauth });

  assert.equal(sync.isLive('google'), false);
  repo.connectCalendar(subscriber.id, 'google', 'google-demo');
  const pushed = await sync.syncSubjects(sub(subscriber.id, subject.id), [subject]);
  assert.equal(pushed.length, 1, 'recorded one event even in demo mode');
});
