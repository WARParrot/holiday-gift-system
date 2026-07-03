// Live end-to-end smoke test against a real running server (HTTP + WebSocket).
// Not part of the unit suite; run manually with: node --import tsx test/smoke.mts
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { buildApp } from '../src/app.js';
import { ChatHub } from '../src/ws/chatHub.js';
import { hashPassword } from '../src/util/auth.js';
import { randomUUID } from 'node:crypto';

const config = { ...loadConfig(), dbFile: ':memory:', enableScheduler: false };
const db = openDatabase(':memory:');
const repo = new Repository(db);

// Seed: subject + planner + subscription
const subjectId = randomUUID();
const plannerId = randomUUID();
repo.createUser({ id: subjectId, email: 's@x.com', passwordHash: hashPassword('password'), fullName: 'Subject', birthdate: '1990-01-01', avatarUrl: null, role: 'USER', createdAt: '' });
repo.createUser({ id: plannerId, email: 'p@x.com', passwordHash: hashPassword('password'), fullName: 'Planner', birthdate: '1991-02-02', avatarUrl: null, role: 'USER', createdAt: '' });

const { app, ctx } = buildApp(config, repo);
const server = createServer(app);
const hub = new ChatHub(server, repo, config, ctx.notifications);
ctx.hub.current = hub;

await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const addr = server.address() as { port: number };
const base = `http://127.0.0.1:${addr.port}`;
let failures = 0;
const check = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`); if (!cond) failures++; };

// 1. Login as planner
const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'p@x.com', password: 'password' }) })).json();
check('planner login returns token', Boolean(login.token));
const plannerToken = login.token as string;

// 2. Planner can access subject's friend card + secret chat
const card = await (await fetch(`${base}/api/users/${subjectId}/card`, { headers: { authorization: `Bearer ${plannerToken}` } })).json();
check('planner sees secret chat on subject card', card.secretChat?.visible === true);
const roomId = card.secretChat.roomId as string;

// 3. Subject is DENIED their own card's chat + room messages
const subjLogin = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 's@x.com', password: 'password' }) })).json();
const subjToken = subjLogin.token as string;
const subjCard = await (await fetch(`${base}/api/users/${subjectId}/card`, { headers: { authorization: `Bearer ${subjToken}` } })).json();
check('subject does NOT see their own secret chat', subjCard.secretChat?.visible === false);
const denied = await fetch(`${base}/api/chat/rooms/${roomId}/messages`, { headers: { authorization: `Bearer ${subjToken}` } });
check('subject gets 403 fetching their own room messages', denied.status === 403);

// 4. WebSocket: planner joins + sends, subject is denied join
const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
await new Promise<void>((r) => ws.on('open', () => r()));
const frames: any[] = [];
ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
ws.send(JSON.stringify({ type: 'auth', token: plannerToken }));
await new Promise((r) => setTimeout(r, 100));
ws.send(JSON.stringify({ type: 'join', roomId }));
await new Promise((r) => setTimeout(r, 100));
ws.send(JSON.stringify({ type: 'message', roomId, body: 'Planning the surprise!' }));
await new Promise((r) => setTimeout(r, 150));
check('planner WS receives ready', frames.some((f) => f.type === 'ready'));
check('planner WS receives joined backlog', frames.some((f) => f.type === 'joined'));
check('planner WS receives broadcast message', frames.some((f) => f.type === 'message' && f.message.body === 'Planning the surprise!'));

const subjWs = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
await new Promise<void>((r) => subjWs.on('open', () => r()));
const subjFrames: any[] = [];
subjWs.on('message', (d) => subjFrames.push(JSON.parse(d.toString())));
subjWs.send(JSON.stringify({ type: 'auth', token: subjToken }));
await new Promise((r) => setTimeout(r, 100));
subjWs.send(JSON.stringify({ type: 'join', roomId }));
await new Promise((r) => setTimeout(r, 150));
check('subject WS join is denied', subjFrames.some((f) => f.type === 'error'));

// 5. Crowdfunding via mock bank
const poolId = randomUUID();
repo.createPool({ id: poolId, subjectId, subjectName: 'Subject', roomId, targetAmount: 100, currentBalance: 0, status: 'OPEN', openedAt: '', cycleKey: `${subjectId}:2099` });
const contrib = await fetch(`${base}/api/chat/rooms/${roomId}/pool/contribute`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${plannerToken}` }, body: JSON.stringify({ amount: 40 }) });
const contribBody = await contrib.json();
check('contribution succeeds via mock bank', contrib.status === 201 && contribBody.pool.currentBalance === 40 && /^MOCK-/.test(contribBody.txRef));

ws.close(); subjWs.close();
server.close();
console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
