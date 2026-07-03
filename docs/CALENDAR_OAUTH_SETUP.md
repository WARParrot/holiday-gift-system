# External Calendar Sync — Setup Guide (Google & Yandex)

BCMS can push a recurring yearly birthday event into a user's **Google
Calendar** and/or **Yandex Calendar** when they subscribe to a friend/group
with calendar sync enabled. Sync is per-user, but the two providers authenticate
**differently** — this is a hard constraint of what each vendor exposes, not a
design choice:

- **Google** — OAuth2 + Calendar API v3. Each user authorizes via the OAuth
  consent screen; the server stores + refreshes their token.
- **Yandex** — CalDAV + an **app-specific password** (HTTP Basic auth). Yandex
  Calendar does **not** accept OAuth for calendar writes, so there is no Yandex
  OAuth app; each user supplies a login + Calendar app password instead.

> **Zero-setup default.** If a provider isn't configured, it runs in **demo
> mode** — the connect flow still works and events are recorded server-side (in
> memory), but nothing is written to a real calendar. This is why the demo and
> the test suite need no external accounts.

Per-provider live switch: **Google** is live iff `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are set; **Yandex** is live iff `YANDEX_CALDAV_ENABLED=1`.
Otherwise the provider is demo.

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

**Yandex Calendar is NOT OAuth.** Unlike Google, Yandex exposes calendar writes
only through **CalDAV**, which authenticates with HTTP **Basic auth** using a
Yandex account login + an **app-specific password** — it does *not* accept an
OAuth2 bearer token. (Verified against Yandex's official docs:
*support/yandex-360/customers/calendar/…/sync/sync-desktop*, which instruct users
to create a **Calendar app password**; there is no OAuth-authenticated Yandex
Calendar write API.)

So there is **no Yandex app to register and no client id/secret.** Instead:

### Server side — enable live Yandex sync

In `server/.env`:
```bash
YANDEX_CALDAV_ENABLED=1
# optional overrides:
# YANDEX_CALDAV_BASE=https://caldav.yandex.ru
# YANDEX_CALDAV_PATH_TEMPLATE=/calendars/{login}/events-default/
```
Without `YANDEX_CALDAV_ENABLED=1`, Yandex runs in demo/recording mode (the
default), so the app works out of the box with no Yandex account. Restart the
server after editing `.env`.

### Per user — connect with an app password

Each user connects their own Yandex account from the profile → Calendar tab:
1. In **Yandex ID → Security → App passwords**, create a password of type
   **Calendar**. (You can only see it once.)
2. In BCMS, click **Connect Yandex Calendar**, then enter the Yandex **login/email**
   and the **app password**.

The server verifies the credential against the CalDAV server (a depth-0
`PROPFIND`) **before storing it**, so a wrong app password is rejected up front
(HTTP 401) instead of failing later during background sync. On success the
login + app password are stored per-user and sent as
`Authorization: Basic base64(login:app-password)` on every CalDAV request.

The adapter serialises each birthday to a single-VEVENT `.ics` resource (RFC
5545: CRLF endings, 75-octet line folding, TEXT escaping, all-day `VALUE=DATE`
with a yearly `RRULE`) and `PUT`s it to a stable, login-scoped href so re-sync is
idempotent; `DELETE` removes it.

> **Note on the CalDAV collection path:** the default template
> `/calendars/{login}/events-default/` targets the account's default events
> collection. If your account's collection differs, override
> `YANDEX_CALDAV_PATH_TEMPLATE` (`{login}` is filled from the login the user
> supplies).

> **Account caveat:** app-password CalDAV works for consumer `@yandex` accounts.
> Some **Yandex 360 organizations disable app passwords by policy**, in which
> case CalDAV writes are blocked regardless — that's an account-admin setting,
> not something the app can work around.

---

## Verifying

- **Without credentials:** `GET /api/calendar/connections` shows providers as
  `live:false`; the UI labels them "demo". Connecting records events in memory.
- **When live:** the same endpoint reports `live:true`. Google's "Connect" sends
  you through the real OAuth consent screen; Yandex's "Connect" reveals a
  login + app-password form (CalDAV). In both cases events then appear in your
  actual calendar.
- The adapters themselves are covered by `server/test/calendarSync.test.ts` and
  `server/test/calendarOAuthRoutes.test.ts`, which run the real Google-REST and
  Yandex-CalDAV request logic against in-process mock servers: Google OAuth token
  exchange + refresh-on-expiry, Yandex **Basic-auth** CalDAV (PROPFIND credential
  check, then PUT/DELETE), idempotent upsert/delete, and RFC-5545 ICS
  generation — no external accounts needed.

## Security notes

- Credentials are stored in the app database — Google OAuth tokens and Yandex
  app passwords alike. Protect the DB file and back it up accordingly; treat it
  as containing secrets. Disconnecting a provider deletes its stored credential.
- The Google OAuth `state` is signed with `JWT_SECRET`; keep that secret strong
  and private (the server already refuses to boot in production with the default).
- The Yandex app password is validated against the CalDAV server before storage
  and is never logged.
- Refresh tokens are long-lived; disconnecting a provider deletes them.
