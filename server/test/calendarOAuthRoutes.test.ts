import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hashPassword, signToken } from '../src/util/auth.js';
import type { UserRow } from '../src/types/domain.js';

/**
 * Drives the calendar OAuth flow through the REAL Express routes:
 *   GET /api/calendar/oauth/google/start   → returns an authorizeUrl
 *   GET /api/calendar/oauth/google/callback → exchanges code, stores token,
 *     records the connection, back-syncs, and redirects to the SPA landing.
 * A throwaway HTTP server plays the Google token + userinfo endpoints.
 */

function mkUser(email: string, name: string): UserRow {
  return {
    id: randomUUID(), email, passwordHash: hashPassword('password'),
    fullName: name, birthdate: '1990-06-15', avatarUrl: null, role: 'USER', balance: 0,
    createdAt: new Date().toISOString(),
  };
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

test('calendar OAuth routes: start → callback stores token, connects, and redirects to the SPA landing', async () => {
  const events = new Map<string, unknown>();
  const provider = await new Promise<{ server: Server; base: string }>((resolve) => {
    const server = createServer(async (req, res) => {
      const url = req.url ?? '';
      const b = await bodyOf(req);
      if (url === '/token') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'ACCESS-1', refresh_token: 'R1', token_type: 'Bearer', expires_in: 3600, scope: 's' }));
        return;
      }
      if (url === '/userinfo') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ email: 'planner@gmail.com' }));
        return;
      }
      if (url.includes('/events')) {
        // Accept the back-sync insert (PUT 404 → POST) so the flow completes.
        if (req.method === 'PUT') { res.writeHead(404); res.end('{}'); return; }
        if (req.method === 'POST') { const p = JSON.parse(b) as { id: string }; events.set(p.id, p); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(p)); return; }
      }
      res.writeHead(500); res.end('unexpected');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });

  const app = createServer();
  try {
    const config = loadConfig({
      DB_FILE: ':memory:', ENABLE_SCHEDULER: '0', RATE_LIMIT_MAX: '100000',
      GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_TOKEN_URL: `${provider.base}/token`,
      GOOGLE_CALENDAR_API_BASE: provider.base,
      GOOGLE_USERINFO_URL: `${provider.base}/userinfo`,
      GOOGLE_AUTH_URL: `${provider.base}/authorize`,
    } as NodeJS.ProcessEnv);
    const repo = new Repository(openDatabase(':memory:'));
    const user = mkUser('planner@x.com', 'Planner');
    const friend = mkUser('bday@x.com', 'Birthday Person');
    [user, friend].forEach((u) => repo.createUser(u));
    // Pre-existing calendar-enabled subscription so the callback back-sync pushes an event.
    repo.upsertSubscription({ id: randomUUID(), subscriberId: user.id, kind: 'FRIEND', targetId: friend.id, calendarSync: true, createdAt: '' });

    const built = buildApp(config, repo);
    app.on('request', built.app);
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    const token = signToken({ userId: user.id, role: user.role }, config.jwtSecret, config.jwtTtl);

    // 1. start → authorizeUrl pointing at the provider consent screen, carrying state.
    const startRes = await fetch(`${origin}/api/calendar/oauth/google/start`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(startRes.status, 200);
    const startBody = (await startRes.json()) as { mode: string; authorizeUrl: string };
    assert.equal(startBody.mode, 'oauth');
    const authUrl = new URL(startBody.authorizeUrl);
    assert.equal(authUrl.origin + authUrl.pathname, `${provider.base}/authorize`);
    const state = authUrl.searchParams.get('state')!;
    assert.ok(state, 'state present');
    assert.equal(authUrl.searchParams.get('access_type'), 'offline');

    // 2. callback (as the browser would arrive: no bearer, just code+state) → redirect to SPA landing.
    const cbRes = await fetch(`${origin}/api/calendar/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(cbRes.status, 302);
    const loc = cbRes.headers.get('location') ?? '';
    assert.match(loc, /^\/profile\?calendar=google&status=connected/);

    // 3. token + connection persisted; back-sync pushed the birthday event.
    const stored = repo.getCalendarToken(user.id, 'google');
    assert.ok(stored, 'token stored');
    assert.equal(stored!.accessToken, 'ACCESS-1');
    assert.equal(stored!.accountLogin, 'planner@gmail.com');
    assert.equal(repo.listCalendarConnections(user.id).length, 1);
    assert.equal(events.size, 1, 'back-sync inserted the event into the (mock) calendar');

    // 4. a forged/garbage state is rejected (redirects with an error, stores nothing new).
    const badCb = await fetch(`${origin}/api/calendar/oauth/google/callback?code=x&state=not-a-valid-state`, { redirect: 'manual' });
    assert.equal(badCb.status, 302);
    assert.match(badCb.headers.get('location') ?? '', /status=error&detail=bad_state/);
  } finally {
    app.close();
    provider.server.close();
  }
});
