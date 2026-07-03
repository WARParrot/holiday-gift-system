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
