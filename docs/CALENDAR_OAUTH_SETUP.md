# External Calendar Sync — Setup Guide (Google & Yandex)

BCMS can push a recurring yearly birthday event into a user's **Google
Calendar** and/or **Yandex Calendar** when they subscribe to a friend/group
with calendar sync enabled. Each user authorizes their own calendar via OAuth2;
the server stores per-user tokens and refreshes them automatically.

> **Zero-setup default.** If you don't configure a provider's credentials, that
> provider runs in **demo mode** — the connect flow still works and events are
> recorded server-side (in memory), but nothing is written to a real calendar.
> This is why the demo and the test suite need no external accounts. Configure
> the credentials below to switch a provider to **live** sync.

The switch is automatic and per-provider: a provider is **live** iff **both** its
`*_CLIENT_ID` and `*_CLIENT_SECRET` are set. Otherwise it's demo.

## Where to put the credentials (`.env`)

The server auto-loads a `.env` file from the **server package root**
(`server/.env`) at startup — resolved relative to the server root, so it works
regardless of the working directory the process is launched from (handy on
Windows). Get started by copying the template:

```bash
cd server
cp .env.example .env      # Windows PowerShell: copy .env.example .env
# then edit .env and fill in the values below
```

Notes:
- **Real OS/shell/service environment variables take precedence** over `.env`
  (the loader never overrides an already-set variable), so `.env` is a
  convenient default, not a way to override production config.
- `.env` is git-ignored — never commit real secrets. `.env.example` is the
  tracked, secret-free template.
- To load from a different path, set `DOTENV_CONFIG_PATH=/abs/path/to/.env`.
- On Windows you can alternatively set these as user/system environment
  variables (`setx`, or *Edit environment variables for your account*) or inline
  per PowerShell session (`$env:NAME="value"`) — any of these work since the app
  reads `process.env`; `.env` is just the least error-prone option.

---

## How the flow works

```
User clicks "Connect Google"        (SPA → GET /api/calendar/oauth/google/start)
  └─ server returns { authorizeUrl }  (or { mode:'demo' } when not configured)
Browser redirects to Google consent screen
  └─ user approves
Google redirects back                (GET /api/calendar/oauth/google/callback?code&state)
  └─ server verifies the signed `state`, exchanges `code` → tokens,
     stores them, marks the connection live, back-syncs existing subscriptions,
     then redirects the browser to /profile?calendar=google&status=connected
```

- **`state`** is an HMAC-signed, 10-minute-expiry token binding the flow to the
  initiating user — no server session needed, and it doubles as CSRF protection.
- **Tokens** live in the `calendar_oauth_tokens` table (one row per user+provider),
  separate from the display `calendar_connections` row. Access tokens are
  refreshed transparently on expiry using the stored refresh token.
- **Disconnecting** deletes both the connection and the stored tokens.

---

## Google Calendar

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create
   (or pick) a project.
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen:** configure it (External is fine
   for testing), add the scope
   `https://www.googleapis.com/auth/calendar.events`, and add your Google
   account as a **Test user** while the app is unverified.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Web application.** Under **Authorized redirect URIs** add exactly:
   ```
   https://YOUR_HOST/api/calendar/oauth/google/callback
   ```
   (for local dev: `http://localhost:4000/api/calendar/oauth/google/callback`)
5. Add the client id/secret to `server/.env`:
   ```bash
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   PUBLIC_BASE_URL=http://localhost:4000     # so the default redirect URI matches
   # optional: GOOGLE_REDIRECT_URI=... if you want a non-default path
   # optional: GOOGLE_CALENDAR_ID=primary
   ```
   Restart the server after editing `.env`.

The adapter writes an all-day, `FREQ=YEARLY` event via Calendar API v3, using a
deterministic event id derived from the subscriber+subject so re-syncing updates
the same event rather than duplicating it.

---

## Yandex Calendar

Yandex Calendar is a **CalDAV** service; we authenticate CalDAV requests with the
OAuth2 bearer token.

1. Go to the [Yandex OAuth app registry](https://oauth.yandex.com/client/new).
2. Create an application. Under **Platforms** choose *Web services* and set the
   **Redirect URI** to exactly:
   ```
   https://YOUR_HOST/api/calendar/oauth/yandex/callback
   ```
3. Under **Permissions**, grant calendar access and email login (scopes
   `calendar:all` and `login:email`).
4. Add the client id/secret to `server/.env`:
   ```bash
   YANDEX_CLIENT_ID=xxxxxxxx
   YANDEX_CLIENT_SECRET=xxxxxxxx
   PUBLIC_BASE_URL=http://localhost:4000
   # optional overrides:
   # YANDEX_CALDAV_PATH_TEMPLATE=/calendars/{login}/events-default/
   ```
   Restart the server after editing `.env`.

The adapter serialises each birthday to a single-VEVENT `.ics` resource (RFC
5545: CRLF endings, 75-octet line folding, TEXT escaping, all-day `VALUE=DATE`
with a yearly `RRULE`) and `PUT`s it to a stable, login-scoped href so re-sync is
idempotent; `DELETE` removes it.

> **Note on the CalDAV collection path:** the default template
> `/calendars/{login}/events-default/` targets the account's default events
> collection. If your Yandex account's collection differs, override
> `YANDEX_CALDAV_PATH_TEMPLATE` (the `{login}` placeholder is filled from the
> account login returned by userinfo).

---

## Verifying

- **Without credentials:** `GET /api/calendar/connections` shows providers as
  `live:false`; the UI labels them "demo". Connecting records events in memory.
- **With credentials:** the same endpoint reports `live:true`; "Connect" sends
  you through the real consent screen and events appear in your actual calendar.
- The adapters themselves are covered by `server/test/calendarSync.test.ts`,
  which runs the real Google-REST and Yandex-CalDAV request logic against
  in-process mock servers (token exchange, refresh-on-expiry, idempotent
  upsert/delete, and RFC-5545 ICS generation) — no external accounts needed.

## Security notes

- Tokens are stored in the app database. Protect the DB file and back it up
  accordingly; treat it as containing secrets.
- The OAuth `state` is signed with `JWT_SECRET`; keep that secret strong and
  private (the server already refuses to boot in production with the default).
- Refresh tokens are long-lived; disconnecting a provider deletes them.
