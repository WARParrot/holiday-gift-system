# Birthday Celebration Management System — Internal Design Specification

**Audience:** the engineering team maintaining and extending BCMS.
**Status:** implemented and verified (see [§10 Verification](#10-verification--test-strategy)).
**Scope:** this document explains *what* the system does, *why* each subsystem is
built the way it is, and the invariants that must never be broken. Read it before
touching the secret-chat, subscription, or crowdfunding code.

---

## 1. Product summary

BCMS helps a community **never miss a birthday** and **coordinate surprises**.
Five capabilities, mapped to the four core acceptance scenarios:

| # | Scenario                          | Capability                                                        |
|---|-----------------------------------|-------------------------------------------------------------------|
| 1 | Discovery & directory inspection  | Browse all users/groups sorted by upcoming birthday; Friend Cards |
| 2 | Subscription setup                | Subscribe to a friend or a whole group; optional calendar sync    |
| 3 | Wishlist review & management      | Owners CRUD their wishlist; others mark items "suggested"         |
| 4 | Secret chat coordination          | Real-time chat about a person that the person **cannot see**      |
| + | Crowdfunding                      | Auto-opened gift pools funded through a mock bank                 |

### The one invariant that matters most

> **A user is the _subject_ of exactly one secret coordination chat — the one
> about their own birthday — and must NEVER be able to read it, join it, list
> it, or learn it exists.**

Everything in the chat/notification/subscription layer is designed around this
exclusion. See [§6](#6-secret-chat--the-exclusion-model).

---

## 2. Architecture at a glance

```
┌────────────────────────┐        REST /api/*          ┌──────────────────────────┐
│   web/ (React SPA)     │  ───────────────────────►   │   server/ (Express)       │
│                        │                              │                           │
│  Zustand stores        │        WebSocket /ws         │  Routes → Services → Repo │
│  React Router          │  ◄─────────────────────────► │  ChatHub (ws)             │
│  Vite + Tailwind       │        live chat + pools     │  Scheduler (setInterval)  │
└────────────────────────┘                              │  better-sqlite3 (WAL)     │
                                                        └──────────────────────────┘
```

- **One language end-to-end** (TypeScript, `strict`). The API contract lives in
  `server/src/types/domain.ts` and is mirrored in `web/src/types/domain.ts`.
- **Layered backend:** `routes/` (HTTP) → `services/` (business logic) →
  `db/repository.ts` (all SQL). Routes never write SQL; services never touch
  `req`/`res`. This keeps the exclusion rule testable in isolation.
- **Two run modes:** dev = Vite proxy to the API; prod = the API server serves
  the built SPA statically from one process (`WEB_DIST`).

---

## 3. Technology choices & rationale

| Choice              | Why                                                                                     |
|---------------------|------------------------------------------------------------------------------------------|
| **better-sqlite3**  | Zero-config, synchronous, transactional. Perfect for a self-contained deliverable. Swappable behind `Repository`. |
| **Raw `ws`**        | The chat protocol is small and bespoke; a full framework (Socket.IO) would add weight for no gain. |
| **Zod**             | One schema per endpoint validates input *and* derives the TypeScript type (`z.infer`).   |
| **JWT (stateless)** | No server session store; the token carries `{ userId, role }`. Same secret verifies REST + WS. |
| **Zustand**         | Minimal global state (auth, notifications) without Redux boilerplate.                    |

---

## 4. Data model

All tables are created in `server/src/db/schema.ts`. Key relationships:

```
users ──< group_members >── groups
users ──< wishlist_items
users ──< subscriptions (kind = FRIEND → users.id | GROUP → groups.id)
users ──1 chat_rooms (subject_id, UNIQUE)  ──< chat_messages
chat_rooms ──< crowdfunding_pools ──< pool_contributions
users ──< notifications (UNIQUE(user_id, dedupe_key))
```

Notable constraints and why they exist:

- **`chat_rooms.subject_id` UNIQUE** — exactly one coordination room per person.
- **`crowdfunding_pools.cycle_key` UNIQUE** (`{subjectId}:{year}`) — prevents a
  second pool opening for the same birthday cycle if the scheduler ticks twice.
- **`notifications UNIQUE(user_id, dedupe_key)`** — makes reminder delivery
  idempotent. The scheduler can run every hour without ever double-notifying.
- Foreign keys use `ON DELETE CASCADE` so admin user-deletion cleans up
  memberships, wishlists, messages, and contributions.

---

## 5. Subscriptions, reminders & notifications

### Subscription semantics (scenario 2)
A subscription is `(subscriberId, kind, targetId)`:
- `FRIEND` → notified about that one user's birthday.
- `GROUP` → notified about **every current member's** birthday. Membership is
  resolved *at notification time*, so people joining the group later are covered
  automatically.

`Repository.subscriberIdsForSubject(subjectId)` is the single source of truth for
"who hears about this person's birthday". It unions direct friend-subscribers
and group-subscribers, then **removes the subject themselves** — so a user who
happens to be in a group they also subscribe to never gets notified about their
own birthday.

### Scheduler (`services/notifications.ts → runTick`)
Runs on an interval (default hourly; `SCHEDULER_INTERVAL_MS`) and on demand via
`POST /api/notifications/run-scheduler`:
1. For each offset in `REMINDER_OFFSETS` (default `7,3,1` days), find users whose
   birthday is exactly that many days away and notify their subscribers.
2. At `POOL_LEAD_DAYS` (default 7), auto-open a crowdfunding pool + post a
   `POOL_OPENED` notification.

Idempotency is structural, not procedural: every emission carries a `dedupeKey`
(`reminder:{subjectId}:{cycleYear}:{offset}` / `pool:{subjectId}:{cycleYear}`)
and the DB's UNIQUE constraint drops duplicates. This is why re-ticking is safe.

---

## 6. Secret chat — the exclusion model

This is the security core. **All** access — REST and WebSocket — funnels through
one function so the rule cannot drift between transports:

```
services/chatAccess.ts
  canAccessSubjectChat(subjectId, requesterId) → denies if subjectId === requesterId
  canAccessRoom(repo, roomId, requesterId)     → looks up room, delegates to the above
```

Enforcement points:
- **Friend Card API** (`GET /api/users/:id/card`) returns `secretChat.visible=false`
  when the viewer *is* the subject — the client never even receives a room id.
- **Chat REST** (`/api/chat/...`) returns `403` for the subject on their own room.
- **WebSocket hub** re-checks `canAccessRoom` on every `join` and every `message`
  frame — so a subject crafting raw frames still cannot stream or post.
- **Notification fan-out** excludes the subject (see §5).

> **When extending chat, never bypass `chatAccess`.** Add new entry points
> *through* it. There is a regression test asserting the subject gets a 403 and a
> WS `error` — keep it green.

### WebSocket protocol (`ws/chatHub.ts`)
JSON frames on `/ws`: `auth` → `ready`, `join` → `joined`(backlog), `message` →
broadcast `message`, plus server-pushed `pool` updates. The socket must
authenticate (JWT) before any join/message.

---

## 7. Crowdfunding & the mock bank

- Pools auto-open via the scheduler (§5) or can pre-exist; they belong to a chat
  room, so **only chat participants (never the subject) can contribute** — the
  contribute endpoint runs through `canAccessRoom`.
- `services/mockBank.ts → processMockCharge` **simulates** a payment processor:
  it validates the amount (positive, under a per-charge cap), returns a
  deterministic-looking `txRef`, and never touches a real network or real money.
  This is a deliberate, self-contained stand-in — swap it for a real PSP adapter
  behind the same interface.
- `Repository.addContribution` wraps the insert + balance update in a single
  **SQLite transaction** so the pool balance can never drift from the sum of
  contributions.
- Successful contributions push a live `pool` frame to everyone in the room via
  the ChatHub, so the progress bar updates in real time.

---

## 8. External calendar sync

The spec requires Google/Yandex calendar sync. Real OAuth2 + Calendar API calls
need live third-party credentials that aren't available in this environment, so
`services/calendarSync.ts` implements the full integration **shape** behind a
provider interface:

- `CalendarProvider` — the contract a real Google/Yandex adapter implements
  (`upsertEvent` / `removeEvent`).
- `RecordingCalendarProvider` — the default in-memory adapter. It records the
  exact recurring (`FREQ=YEARLY`) events that *would* be pushed, keyed by a
  stable UID (`bcms-{subscriber}-{subject}@bcms`) so re-sync is idempotent.

**To go live:** implement `CalendarProvider` with `googleapis` / Yandex REST plus
an OAuth2 token store and inject it at construction in `app.ts`. No call-site
changes required. This is honest about what's real (the sync logic and event
shape) vs. simulated (the network call).

---

## 9. Admin back-office

`/api/admin/*` is gated by `requireAuth` + `requireAdmin`. It provides:
- Full user CRUD, group/wishlist deletion.
- **Data portability:** `GET /export?format=json|csv` and `POST /import`
  (JSON array or CSV). The CSV parser handles quoted fields with embedded commas.
  Imports are upsert-safe (existing emails are skipped, not duplicated).

---

## 10. Verification & test strategy

| Layer                         | How it's verified                                              |
|-------------------------------|----------------------------------------------------------------|
| Type safety                   | `tsc` strict on both packages (`npm run typecheck`, `build`)   |
| Exclusion invariant           | `test/chatAccess.test.ts` — subject denied by id and by room   |
| Subscription fan-out          | asserts subject is never their own subscriber                  |
| Scheduler idempotency         | `test/scheduler.test.ts` — second tick emits 0 duplicates      |
| Crowdfunding correctness      | `test/crowdfunding.test.ts` — transactional balance, cycle key |
| Mock bank validation          | rejects non-positive / over-cap; approves valid charges        |
| End-to-end (HTTP + WS)        | `test/smoke.mts` — login, card visibility, WS join/broadcast, subject denial, contribution |
| Single-process serving        | built server serves SPA + deep-link fallback + static assets (manually verified) |

Run everything:
```bash
cd server && npm run typecheck && npm test && npm run build
cd web    && npm run typecheck && npm run build
node --import tsx server/test/smoke.mts   # live HTTP+WS
```

---

## 11. Known limitations / future work

- **Calendar sync** records events in-memory; wire a real provider for
  production (§8).
- **Mock bank** is a simulation; integrate a real PSP for live payments (§7).
- **Invite-only groups** currently only auto-admit the owner; a full invitation
  token flow is a natural next step.
- **Notification delivery** is in-app (polled every 15s) + WS pushes; email/push
  channels can subscribe to the same `NotificationService` sink hooks.
- **Auth** is a single access token (no refresh rotation) — adequate for the
  deliverable, revisit for long-lived sessions.

---

## 12. Directory map

```
server/src/
  config.ts              env-driven config (ports, secrets, scheduler, WEB_DIST)
  app.ts                 Express assembly + optional SPA static serving
  index.ts               entrypoint: DB, ChatHub, scheduler loop, listen
  db/
    schema.ts            table DDL + PRAGMA (WAL, foreign_keys)
    repository.ts        ALL SQL lives here (data-access layer)
    migrate.ts           schema + realistic demo seed
  services/
    chatAccess.ts        THE exclusion decision (shared REST + WS)
    notifications.ts     scheduler: reminders + pool auto-open, idempotent
    mockBank.ts          simulated payment processor
    calendarSync.ts      provider interface + in-memory recording adapter
  routes/                auth, users(+friend card), groups, wishlist,
                         subscriptions, notifications, chat(+pool), admin
  middleware/auth.ts     requireAuth / requireAdmin
  ws/chatHub.ts          WebSocket server, protocol, live fan-out
  util/                  auth (bcrypt+jwt), dates, validate (zod)
  test/                  unit tests + smoke.mts (live E2E)

web/src/
  api/client.ts          typed fetch wrapper for every endpoint
  store/                 auth + notifications (Zustand)
  hooks/useChatSocket.ts WebSocket lifecycle for one room
  components/            Layout, Avatar, NotificationBell, SecretChat, Feedback
  pages/                 Login, Directory, Groups, GroupDetail, FriendCard,
                         Subscriptions, Wishlist, Profile, Admin
```

---

## 13. Version 1.1 — wallet, payments, calendar UI, admin money & groups

This release closes the production gaps identified after the first delivery.

### 13.1 Wallet / balance model

- `users.balance` (REAL) holds each account's funds; `wallet_transactions` is a
  signed, append-only ledger (`TOPUP` / `CONTRIBUTION` / `ADMIN_ADJUST` /
  `REFUND`) recording `amount`, `balance_after`, `memo`, and `tx_ref`.
- `Repository.applyWalletTransaction` performs the balance mutation **and** the
  ledger insert inside one SQLite transaction. It **rejects overdrawing debits**
  (returns `null`) unless `allowNegative` is set — used only for admin
  adjustments. This is the single choke-point for every balance change.
- **Money now flows end-to-end:** `POST /api/payments/topup` credits the wallet
  through the same `processMockCharge` pseudo-bank; crowdfunding contributions
  (`/chat/rooms/:id/pool/contribute`) first check balance, then debit the wallet
  and credit the pool. A contribution that exceeds balance returns `402`.

### 13.2 Payment & calendar surfaces (profile widget)

- The header avatar is a button opening `components/ProfileWidget.tsx`, a
  slide-over with **Account**, **Payment**, and **Calendar** subpages. Balance
  is shown in the header chip and the widget; both stay in sync via the Zustand
  auth store after any top-up/contribution.
- `calendar_connections` (PK `user_id + provider`) persists Google/Yandex
  links. `POST /api/calendar/connections` records the link and **back-syncs**
  the user's calendar-enabled subscriptions into the provider through the
  existing `CalendarSyncService` (still the recording adapter — §8 unchanged).

### 13.3 Admin money & full group management

- **Money:** `PATCH /api/admin/users/:id/balance` (adjust or set, audited via
  `ADMIN_ADJUST` ledger rows), `GET /api/admin/users/:id/wallet`,
  `GET /api/admin/pools`, and `PUT /api/admin/pools/:id` (edit
  target/balance/status; pushes a live `pool` frame to the room).
- **Groups:** create / update (name, description, visibility, owner) / delete,
  plus `POST` and `DELETE` member endpoints — surfaced in the Admin → Groups
  tab with an inline member editor.

### 13.4 Seed data

`migrate.ts` now assigns starting balances and creates an **active gift pool for
Carol** (target 150) pre-funded by Alice (50) and Bob (30), with matching wallet
debits — so the crowdfunding display and ledgers are populated on first run.

### 13.5 Schema migration safety

`applyMigrations()` in `schema.ts` adds the `balance` column to `users` on
pre-existing databases (SQLite lacks `ADD COLUMN IF NOT EXISTS`), so upgrading an
old on-disk DB doesn't require a re-seed.

### 13.6 New tests

`test/wallet.test.ts` covers credit/debit ledger movement, overdraw refusal,
admin negative adjust, calendar connect/disconnect upsert, and admin pool
finance updates. `test/smoke.mts` gained live checks for top-up, over-balance
refusal, balance-debiting contribution, and calendar connect.

---

## 14. Version 1.2 — security-hardening / review-fix pass

This release closes the findings from an external code review of the 1.1 build.
The headline change reworks the secret-chat authorization from a *negative* rule
into an explicit *positive* model; the rest hardens auth, transport, and
auditing. Every change is covered by tests (`test/http.test.ts`,
`test/chatAccess.test.ts`, `test/dates.test.ts`).

### 14.1 Positive authorization for the secret chat (supersedes §6)

The 1.1 rule was purely negative: `canAccessSubjectChat` allowed *everyone who
was not the subject*. There was no `chat_participants` concept, so "who is
allowed" was un-enumerable. 1.2 introduces an explicit allowlist:

```
chat_participants(room_id, user_id, role, source, joined_at)
  role   = ORGANIZER | PARTICIPANT
  source = FRIEND | GROUP        -- how the user became eligible
```

`services/chatAccess.ts` now models two stages:

```
checkEligibility(repo, subjectId, requesterId)
  → may this user JOIN?  eligible iff (not the subject) AND
    repo.subscriptionSourceFor(requesterId, subjectId) is FRIEND or GROUP
canAccessRoom(repo, roomId, requesterId)
  → may this user READ/POST now?  allowed iff room exists AND
    (not the subject) AND repo.isParticipant(roomId, requesterId)
```

Consequences:
- **Joining is an explicit `POST /api/chat/subject/:id/room/join`.** It checks
  eligibility, lazily creates the room on first join, and records the caller as
  a participant (first joiner = ORGANIZER). This is the *only* place a room /
  grant is materialised.
- **The old GET-side room auto-creation is removed.** `GET /users/:id/card` no
  longer mutates state; it reports `secretChat.visible` (already a participant)
  or `{ visible:false, eligible }` so the client can offer a "Join" action.
- **A stranger with no subscription relationship is denied** (`NOT_ELIGIBLE` →
  403), not silently allowed. The subject is still denied unconditionally
  (`IS_SUBJECT`). This subsumes the 1.1 "subscriptions are overloaded" remark:
  eligibility *is* the subscription relationship.

> The §6 rule "never bypass `chatAccess`" still holds — the functions changed,
> the discipline did not. Both transports (REST + WS) funnel through
> `canAccessRoom`, and the WS hub additionally re-validates the JWT subject
> against the DB on `auth`.

### 14.2 Auth hardening

- `config.ts` **hard-fails on boot** in `NODE_ENV=production` if `JWT_SECRET` is
  unset / equals the dev default — no more accidental forge-any-token prod boot.
- `middleware/auth.ts` now takes the repo and **re-validates every request
  against the DB**: a token for a deleted account is rejected (401) immediately
  instead of surviving until the 7-day expiry (the team-reported
  "delete-then-still-authenticated" bug), and the role is read from the DB, so
  admin grant/revoke takes effect at once rather than being frozen in the token.

### 14.3 Transport hardening

- **Rate limiting** (`middleware/rateLimit.ts`): a dependency-free per-IP
  fixed-window limiter — a general cap on `/api/` plus a stricter cap on
  `/api/auth`. Tunable via `RATE_LIMIT_*` env vars.
- **CORS**: the wide-open `cors()` is replaced by an allowlist built from
  `CORS_ORIGINS` (empty = same-origin only).
- **WebSocket frames**: every inbound frame is zod-validated (discriminated
  union on `type`, string bounds, 4000-char message cap) and the socket payload
  size is bounded, so malformed / oversized frames never reach the DB.

### 14.4 REST/WS notification parity

The REST send path (`POST …/messages`) previously broadcast to WS clients but
skipped subscriber notifications. Both paths now call a single
`ChatHub.onMessagePosted(message)` that clears the author's own counter and fans
out subscriber notifications — behavioural parity between transports.

### 14.5 Auditable admin pool edits

`repo.updatePoolFinance(..., adminId)` no longer writes `current_balance`
directly. Target/status are metadata (set directly); a balance change is applied
as a reconciling row in `pool_contributions` (attributed to the admin), so a
pool's balance always equals the sum of its contribution trail. (User-balance
admin edits already went through the `ADMIN_ADJUST` wallet ledger — that was
correct and is unchanged; this fix targets pools only.)

### 14.6 Message pagination

`repo.listMessages(roomId, { limit, before })` replaces the fixed 500-row cap.
The cursor is keyed on the monotonic `rowid` (insertion order), **not**
`created_at` — the latter has only second resolution and would drop/duplicate
rows within a burst. `GET …/messages?limit=&before=<messageId>` returns a
`nextBefore` cursor for the previous (older) page.

### 14.7 Louder demo labeling

The mock bank and the simulated (no real OAuth) Google/Yandex calendar
integration are now called out explicitly in the profile UI, so their demo
nature isn't mistaken for a live integration.

### 14.8 New tests

- `test/http.test.ts` — HTTP-layer integration (real Express app): stranger 403
  / eligible-friend 201 join, no GET-side room creation, deleted-user token
  rejection, DB-authoritative role, REST/WS notify parity, message pagination.
- `test/chatAccess.test.ts` — rewritten for the positive model: subject hard
  exclusion, participant-grant requirement, stranger `NOT_ELIGIBLE`, GROUP-source
  eligibility, `ROOM_NOT_FOUND`.
- `test/dates.test.ts` — leap-year (Feb-29) countdown edge cases.
- `test/wallet.test.ts` — updated to assert the pool-edit reconciling ledger row.

Total: **29 tests** (up from 9), plus strict typecheck and build on both
packages, verified from a clean extract of the delivered zip.

---

## 15. Version 1.3 — real external-calendar sync (Google + Yandex)

§8 previously described the calendar integration as a shape behind a recording
adapter. 1.3 makes it a real OAuth2 + API integration, while keeping the
recording adapter as an automatic fallback so the demo/tests need no accounts.

### 15.1 Per-user model

Real calendar sync is inherently per-user: each subscriber has their own OAuth
tokens and their own connected calendars. `CalendarSyncService` was reworked
from a fixed global provider list into a per-user dispatcher:

- adapters are chosen per provider at construction — live when
  `config.calendar.<provider>` is set (credentials present), else a
  `RecordingCalendarProvider`;
- `syncSubjects`/`removeSubjects` iterate only the **connected** providers for
  that subscriber, resolve a valid access token (refreshing if expired), and
  push through the matching adapter;
- the `CalendarProvider` interface is now `upsertEvent(auth, event)` /
  `removeEvent(auth, uid)` — auth (access token + account login) is passed per
  call, not baked into the adapter.

### 15.2 OAuth2 (`services/calendarOAuth.ts`)

Authorization-code flow, raw `fetch`, no new deps:

- `buildState/verifyState` — the `state` is `<userId>.<provider>.<expiry>.<nonce>.<hmac>`,
  HMAC-signed with the app JWT secret (10-min expiry). This binds the callback
  to the initiating user *and* is the CSRF defense, with no server session.
- `authorizeUrl` — Google gets `access_type=offline&prompt=consent` so a refresh
  token is returned.
- `exchangeCode` / `refresh` / `fetchAccountLogin` — normalise the two providers'
  token + userinfo shapes.
- `getValidAccessToken` — returns a live token, refreshing (and persisting the
  new access token) when it's within 60s of expiry; returns null if unusable.

Tokens live in their own `calendar_oauth_tokens` table (not
`calendar_connections`) because they're sensitive and refreshed independently;
disconnecting a provider deletes both rows.

### 15.3 Adapters

- **Google** (`GoogleCalendarProvider`, Calendar API v3 REST): idempotent event
  id derived from the event uid (base32hex to satisfy Google's id charset);
  `PUT` to update, falling back to `POST` insert on 404/410; all-day
  `start.date`/`end.date` with `RRULE:FREQ=YEARLY`, `transparency:transparent`.
- **Yandex** (`YandexCalendarProvider`, CalDAV): each event is a single-VEVENT
  `.ics` (built by `services/ics.ts` — RFC-5545 CRLF, 75-octet line folding,
  TEXT escaping, `VALUE=DATE` all-day) `PUT` to a stable login-scoped href
  (`{caldavBase}{path-with-login}{uid}.ics`); `DELETE` is idempotent (404 OK).

### 15.4 Routes (`routes/calendar.ts`)

- `GET /api/calendar/oauth/:provider/start` (authed) — live provider → returns
  `{ mode:'oauth', authorizeUrl }` for the SPA to redirect the top window; demo
  provider → records the connection and back-syncs immediately.
- `GET /api/calendar/oauth/:provider/callback` — **mounted before `requireAuth`**
  (the provider redirects the browser here with no bearer token; the signed
  state carries identity). Verifies state, exchanges the code, stores the token,
  records the connection, back-syncs, then 302s to
  `/profile?calendar=..&status=..` where the SPA shows the outcome.
- `GET /connections` now includes a `live` flag per provider; `DELETE` also
  revokes stored tokens.

### 15.5 Config & gating

`config.calendar.{google,yandex}` is built from `*_CLIENT_ID/_SECRET` (+ optional
endpoint overrides used by the tests to point at mock servers). Absent
credentials ⇒ `null` ⇒ recording fallback. `PUBLIC_BASE_URL` derives the default
redirect URIs. See `docs/CALENDAR_OAUTH_SETUP.md` and `server/.env.example`.

### 15.6 New tests

- `test/calendarSync.test.ts` — the live Google-REST and Yandex-CalDAV adapters
  against in-process mock protocol servers: token exchange, refresh-on-expiry
  (asserts the refreshed bearer is used), PUT-then-POST idempotent insert,
  update-in-place (no duplicate), CalDAV VEVENT shape + login-scoped href, and
  the recording fallback when unconfigured.
- `test/calendarOAuthRoutes.test.ts` — the full HTTP flow through the real
  Express app: `start` → signed authorize URL, `callback` with a forged state
  rejected, valid `callback` exchanging the code and persisting the connection.

Total: **34 tests**. Note: verified against mock protocol servers, **not**
against live Google/Yandex (which needs real registered OAuth apps).

---

## 16. Version 1.4 — dependency-security pass + `.env` loading

### 16.1 Vulnerability remediation

An `npm audit` of the 1.3 tree flagged 7 server + 6 web advisories. All were
fixable **within the existing major versions** (no breaking framework upgrades
except a deliberate, verified Vite 5→6 bump), so the fix is a set of version
bumps rather than code changes:

- **server** — `express` 4.21.2 → 4.22.2 (transitive `path-to-regexp` ReDoS,
  `qs` DoS, `body-parser`), `ws` 8.18.0 → 8.21.0 (uninitialised-memory
  disclosure + tiny-fragment DoS); `jsonwebtoken`, `cors`, `zod`, `tsx`,
  `typescript`, `@types/node` bumped to current patch lines.
- **web** — `react-router-dom` 6.28.0 → 6.30.4 (XSS via open redirect),
  `vite` 5.4.11 → 6.4.3 (dev-server path traversal, `server.fs.deny` bypass,
  Windows launch-editor hash disclosure; also ships a patched esbuild ≥0.25),
  `postcss` 8.4.49 → 8.5.16 (stringify XSS); `@vitejs/plugin-react`, `zustand`,
  `typescript` bumped.

Result: `npm audit` = **0 vulnerabilities** on both packages. Versions remain
**exact-pinned** (no `^`/`~`) so the audited dependency set is reproducible; the
regenerated `package-lock.json` files are the source of truth. The Vite 6 bump
was verified by rebuilding the SPA and starting the dev server (the config uses
only stable `plugins`/`server.proxy` options unaffected by the v5→v6 changes).

### 16.2 `.env` loading (`src/env.ts`)

1.3 read config straight from `process.env` with no file loader, so the
`.env.example` was documentation only. 1.4 adds a real loader:

- `src/env.ts` is a side-effecting module imported **first** at every process
  entry point (`index.ts`, `db/migrate.ts`) — before any `loadConfig()` call.
- It resolves `.env` relative to the **server root** (derived from the module's
  own path via `import.meta.url`), so it loads regardless of the launch cwd —
  important on Windows where the process may start from Explorer/a shortcut/a
  service wrapper. `DOTENV_CONFIG_PATH` overrides the location.
- `dotenv` never overrides an already-set variable, so **real OS/shell/service
  env vars take precedence** over `.env` — the file is a convenient default,
  not a production-config override.
- `.env` / `.env.*` are now git-ignored (except `.env.example`) so real secrets
  can't be committed.

Only one new runtime dependency (`dotenv`, exact-pinned) was added.

---

## 17. Version 1.5 — Yandex calendar corrected to CalDAV app-password auth

### 17.1 The bug and the verification

The v1.3 Yandex adapter (and its v1.4 dependency bump) authenticated CalDAV with
the OAuth2 **bearer** token. A live connect attempt failed: token exchange and
userinfo succeeded, but the CalDAV `PUT` returned **401**. Checked against
Yandex's official docs
(*support/yandex-360/customers/calendar/…/sync/sync-desktop* and *sync-mobile*):
Yandex Calendar syncs over **CalDAV** and authenticates with HTTP **Basic auth**
using the account login + an **app-specific password** created in Yandex ID.
Those pages contain zero mention of `oauth`/`bearer`/`token`; the only documented
credential is an app password. There is no OAuth-authenticated Yandex
calendar-write API — so "OAuth2 for Yandex writes" is not achievable, and the
symmetric-OAuth design of §15 was wrong for Yandex specifically.

Why it wasn't caught earlier: the §15 Yandex test asserted against a mock CalDAV
server *I wrote to accept the bearer* — the mock validated my assumption, not
Yandex's actual contract. This is the standing "verified against mocks, not the
live service" caveat coming due.

### 17.2 The corrected model

Yandex is no longer an OAuth provider. Google stays OAuth2 REST; the two now
authenticate differently, reflecting the vendor asymmetry:

- **Config**: `YandexOAuthConfig` → `YandexCalDavConfig` (just `caldavBase` +
  `calendarPathTemplate`; no client id/secret/redirect). Live gate changed from
  "client id+secret present" to an explicit `YANDEX_CALDAV_ENABLED=1` opt-in
  (default off ⇒ recording demo). `oauthConfigFor` is now Google-only.
- **Credential**: per-user login + app password, stored in the existing
  `calendar_oauth_tokens` row as `tokenType='Basic'`, `accessToken`=app password,
  `accountLogin`=login, `expiresAt=0` (app passwords don't expire until revoked).
  No refresh path.
- **Auth header**: `CalendarAuth` now carries a fully-formed `authHeader`.
  `CalendarSyncService.authFor` builds `Bearer <token>` for Google (refresh on
  expiry as before) and `Basic base64(login:app-password)` for Yandex. Adapters
  are agnostic to how the credential was formed.
- **Connect flow**: Google `start` → `{mode:'oauth', authorizeUrl}` (unchanged);
  Yandex `start` → `{mode:'caldav'}`, signalling the SPA to collect a login +
  app password and POST them to the new
  `POST /api/calendar/connections/yandex/caldav`. That route calls
  `YandexCalendarProvider.verifyCredentials` — a depth-0 `PROPFIND` on the
  events collection — and only stores the credential on a 207/2xx, returning 401
  on a bad app password. The SPA renders a login + app-password form for Yandex
  instead of an OAuth redirect.

### 17.3 Tests

- `test/calendarSync.test.ts` — the Yandex case rewritten to assert **Basic**
  auth: the mock CalDAV server 401s unless the request carries
  `Basic base64(login:app-password)`; `verifyCredentials` returns false on a
  wrong password (401) and true on the right one (207); PUT/DELETE carry Basic
  and hit the login-scoped `.ics` href; ICS body still RFC-5545 correct.
- `test/calendarOAuthRoutes.test.ts` — added a route test: Yandex `start`
  returns `mode:'caldav'`; a wrong app password is rejected (401, nothing
  stored); the right one verifies via PROPFIND, stores a `Basic` credential,
  connects, and back-syncs.

Total: **35 tests**. Standing limit unchanged: verified against mock protocol
servers, not live Yandex; live success also depends on the account permitting
app passwords (some Yandex 360 orgs disable them).

