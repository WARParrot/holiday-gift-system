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
