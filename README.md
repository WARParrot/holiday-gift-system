# Birthday Celebration Management System (BCMS)

A web service that helps people **never miss a friend's birthday**, coordinate
group celebrations in a **secret chat the birthday person can't see**, manage
**wishlists**, run **crowdfunding pools**, and sync events to external
calendars.

This repository is a **monorepo** with two packages:

| Package  | Stack                                             | Purpose                              |
|----------|---------------------------------------------------|--------------------------------------|
| `server` | Node + Express + TypeScript + SQLite + `ws`       | REST API, WebSocket chat, schedulers |
| `web`    | React + TypeScript + Vite + Zustand + Tailwind    | Responsive mobile-first web client   |

> Full internal design documentation lives in [`docs/DESIGN.md`](docs/DESIGN.md).
> Read it first — it explains *why* every subsystem is built the way it is,
> including the secret-chat exclusion model and the crowdfunding pseudo-bank.

## What's new in 1.3 (real external-calendar sync)

The Google/Yandex calendar integration is now a **real** OAuth2 + API
integration instead of a simulated one.

- **Google Calendar** — OAuth2 authorization-code flow + Calendar API v3 (raw
  REST). Pushes an all-day `FREQ=YEARLY` birthday event with a deterministic,
  idempotent event id.
- **Yandex Calendar** — OAuth2 + CalDAV. Serialises each birthday to a spec-correct
  single-VEVENT `.ics` (RFC 5545: CRLF, 75-octet folding, TEXT escaping, all-day
  `VALUE=DATE`) and `PUT`s it to a stable login-scoped href.
- **Per-user tokens** stored in a new `calendar_oauth_tokens` table, refreshed
  transparently on expiry. Sync is per-user: events go only to the calendars
  *that user* connected.
- **Signed-state OAuth** — the `state` param is HMAC-signed (10-min expiry),
  binding the callback to the initiating user; doubles as CSRF protection. No
  server session needed.
- **Zero-setup demo fallback** — a provider with no configured credentials runs
  in the previous in-memory recording mode, so the demo and the full test suite
  still run with no accounts. A provider goes **live** automatically once its
  `*_CLIENT_ID`/`*_CLIENT_SECRET` are set. The UI labels demo providers clearly.
- **Setup guide:** [`docs/CALENDAR_OAUTH_SETUP.md`](docs/CALENDAR_OAUTH_SETUP.md)
  walks through registering the Google and Yandex apps and the env vars.

> The live adapters are verified by `server/test/calendarSync.test.ts` against
> in-process mock Google-REST and Yandex-CalDAV servers (token exchange,
> refresh-on-expiry, idempotent upsert/delete, ICS generation). They are **not**
> verified against the live Google/Yandex services in CI — that requires real
> registered OAuth apps; follow the setup guide to enable and test live sync.

## What's new in 1.2 (security-hardening / review-fix pass)

This release closes the findings from an external code review of the 1.1 build.

- **Positive authorization for the secret chat** — access is now an explicit
  allowlist, not "everyone who isn't the birthday person". A new
  `chat_participants` table (`role`, `source`) records who may read/post. You
  become eligible to *join* only if you subscribe to the subject (as a friend
  or via a shared group); joining is an explicit `POST …/room/join` that grants
  a participant row. Reading/posting requires that row **and** not being the
  subject. The old GET-side room auto-creation (a GET that mutated state and let
  any user materialise any subject's room) is gone.
- **Auth hardening** — the server refuses to boot in `NODE_ENV=production` with
  the insecure default `JWT_SECRET`. Every authenticated request now
  re-validates the principal against the database: a token for a **deleted
  account stops working immediately** (previously it stayed valid until the
  7-day expiry), and the role is read from the DB rather than trusted from the
  (long-lived) token, so grant/revoke of admin takes effect at once.
- **Rate limiting** — a per-IP fixed-window limiter on the whole API, with a
  much stricter cap on the auth endpoints to blunt credential brute-forcing.
- **CORS lockdown** — no more wide-open `cors()`. Same-origin only by default;
  set `CORS_ORIGINS` to an explicit allowlist to permit cross-origin clients.
- **WebSocket hardening** — every inbound frame is schema-validated (shape,
  types, and a 4000-char message cap) and the socket payload size is bounded, so
  malformed or oversized frames can't reach the database.
- **REST/WS notification parity** — messages sent via the REST fallback now fan
  out subscriber notifications and clear the author's own counter, exactly like
  the WebSocket path (previously REST-sent messages skipped notifications).
- **Auditable admin pool edits** — an admin changing a gift pool's balance now
  records a reconciling ledger entry in `pool_contributions`, so a pool's
  balance always equals the sum of its contribution trail (no silent direct
  writes).
- **Paginated message history** — `GET …/messages` accepts `?limit=` and a
  `?before=` cursor (keyed on insertion order, tie-safe) and returns a
  `nextBefore` cursor, replacing the fixed 500-row cap.
- **Louder demo labeling** — the mock bank and the simulated (no-OAuth)
  Google/Yandex calendar integration are called out explicitly in the UI.

### New / changed environment variables

| Variable                 | Default            | Purpose                                             |
|--------------------------|--------------------|-----------------------------------------------------|
| `JWT_SECRET`             | dev-only fallback  | **Required in production** (boot fails without it). |
| `CORS_ORIGINS`           | *(empty)*          | Comma-separated allowlist; empty = same-origin only.|
| `RATE_LIMIT_WINDOW_MS`   | `60000`            | Rate-limit window length.                           |
| `RATE_LIMIT_MAX`         | `300`              | Max general API requests / IP / window.             |
| `RATE_LIMIT_AUTH_MAX`    | `10`               | Max auth attempts / IP / window.                    |

## What's new in 1.1 (production-hardening pass)

- **Clickable avatar → profile widget** — the header avatar opens a slide-over
  with three subpages: **Account** (name/birthdate/avatar), **Payment**
  (wallet balance, top-up via the mock bank, transaction ledger), and
  **Calendar** (connect/disconnect Google & Yandex).
- **Explicit account balance** — every user has a wallet balance, shown in the
  header chip and the profile widget. Crowdfunding contributions now **debit
  the wallet** (with an insufficient-funds guard), so money flows end-to-end:
  top up → balance → contribute.
- **Functioning crowdfunding display** — the seed DB now ships an **active gift
  pool** (Carol's birthday) pre-funded with contributions, and the pool widget
  shows progress, contributor list, target-reached state, and live updates.
- **Admin money management** — admins can adjust/set any user's balance and
  edit any gift pool's target/balance/status.
- **Full admin group management** — create, rename, re-scope, delete groups and
  add/remove members, all from the Admin → Groups tab.

---

## Quick start

Requires Node.js 20+.

```bash
# 1. Backend
cd server
npm install
npm run migrate      # create + seed the SQLite database
npm run dev          # http://localhost:4000  (REST + WS on same port)

# 2. Frontend (separate terminal)
cd web
npm install
npm run dev          # http://localhost:5173  (proxies /api and /ws to :4000)
```

Seed logins (password is `password` for all):

| Email                | Role  | Notes                                        |
|----------------------|-------|----------------------------------------------|
| `alice@example.com`  | USER  | Subscribed to Carol + the Volleyball Team    |
| `bob@example.com`    | USER  | Member of Volleyball Team                    |
| `carol@example.com`  | USER  | Birthday **tomorrow** (fires a reminder)     |
| `dave@example.com`   | USER  | Birthday **in 7 days** (fires a reminder)    |
| `erin@example.com`   | USER  | Birthday **in 14 days** (auto-opens a pool)  |
| `admin@example.com`  | ADMIN | Access to the back-office UI                 |

> Carol/Dave/Erin birthdates are seeded relative to *today* so the reminder and
> crowdfunding schedulers have something to fire on immediately. Trigger a tick
> manually from the Subscriptions page ("Run reminder scheduler") or
> `POST /api/notifications/run-scheduler`.

## Production: single-process mode

Build both packages, then serve the SPA and API from one Node process:

```bash
cd web && npm run build          # emits web/dist
cd ../server && npm run build    # emits server/dist
cd server && npm run migrate     # seed (once)
npm start                        # auto-detects ../web/dist and serves it on :4000
```

The server auto-detects `../web/dist`; override with `WEB_DIST=/abs/path`. In
this mode `/api/*` and `/ws` are served alongside the static SPA (with a
client-side-routing fallback), so no proxy is needed.

## Verification

```bash
cd server && npm run typecheck && npm test && npm run build
cd web    && npm run typecheck && npm run build
```

## Repository layout

```
server/   REST API, WebSocket server, reminder + crowdfunding schedulers
web/      React SPA implementing the 4 core user scenarios
docs/     DESIGN.md — full internal specification for the dev team
```
