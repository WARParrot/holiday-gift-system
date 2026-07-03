import { Router } from 'express';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { yandexCalDavConnectSchema } from './schemas.js';
import { YandexCalendarProvider } from '../services/calendarSync.js';
import type { CalendarProviderName } from '../types/domain.js';

/**
 * Calendar connection surface. Backs the profile "Calendar" subpage and the
 * external-calendar OAuth flow:
 *  - GET    /api/calendar/connections                 → connected providers + live flag
 *  - DELETE /api/calendar/connections/:provider       → disconnect (drops OAuth token too)
 *  - GET    /api/calendar/oauth/:provider/start       → begin OAuth consent (redirect)
 *  - GET    /api/calendar/oauth/:provider/callback    → OAuth redirect target
 *
 * When a provider is configured with OAuth credentials it runs "live" and the
 * connect flow is the real authorization-code dance: start → provider consent →
 * callback → token exchange → store token + connection → back-sync subscriptions.
 * When a provider is NOT configured it runs in demo/recording mode; `start`
 * short-circuits by recording a connection directly (no external redirect) so
 * the demo keeps working with zero setup.
 */
function isProvider(v: string): v is CalendarProviderName {
  return v === 'google' || v === 'yandex';
}

export function calendarRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config, calendar, calendarOAuth } = ctx;

  // OAuth redirect target. Registered BEFORE requireAuth: the provider redirects
  // the browser here directly with no Authorization header — the signed `state`
  // (not a bearer token) carries and verifies the initiating user.
  router.get('/oauth/:provider/callback', async (req, res) => {
    const provider = req.params.provider;
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const landing = (ok: boolean, detail: string) =>
      `/profile?calendar=${encodeURIComponent(provider)}&status=${ok ? 'connected' : 'error'}&detail=${encodeURIComponent(detail)}`;

    if (!isProvider(provider)) {
      res.redirect(landing(false, 'unknown_provider'));
      return;
    }
    const verified = calendarOAuth.verifyState(state);
    if (!verified || verified.provider !== provider) {
      res.redirect(landing(false, 'bad_state'));
      return;
    }
    if (!code) {
      res.redirect(landing(false, 'no_code'));
      return;
    }

    try {
      const tokens = await calendarOAuth.exchangeCode(provider, code);
      const login = await calendarOAuth.fetchAccountLogin(provider, tokens.accessToken);
      repo.upsertCalendarToken({
        userId: verified.userId,
        provider,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: tokens.tokenType,
        scope: tokens.scope,
        accountLogin: login,
        expiresAt: tokens.expiresAt,
      });
      repo.connectCalendar(verified.userId, provider, login || `${provider}-account`);
      await backSync(ctx, verified.userId);
      res.redirect(landing(true, login || 'ok'));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Calendar OAuth callback failed:', err);
      res.redirect(landing(false, 'exchange_failed'));
    }
  });

  // Everything below requires an authenticated SPA session.
  router.use(requireAuth(config, repo));

  router.get('/connections', (req, res) => {
    const connections = repo.listCalendarConnections(req.principal!.userId).map((c) => ({
      ...c,
      live: calendar.isLive(c.provider),
    }));
    res.json({
      connections,
      // Advertise which providers are configured for live OAuth so the UI can
      // label the demo ones honestly.
      providers: {
        google: { live: calendar.isLive('google') },
        yandex: { live: calendar.isLive('yandex') },
      },
    });
  });

  // Begin the connect flow. The mode depends on the provider's auth model:
  //   - demo (not live)      → record a labelled connection directly, no external call;
  //   - google (live, OAuth) → return an authorize URL for the SPA to redirect to;
  //   - yandex (live, CalDAV)→ return mode 'caldav' so the SPA collects login +
  //                             app password and POSTs them to the endpoint below
  //                             (Yandex CalDAV uses Basic auth, not OAuth).
  router.get('/oauth/:provider/start', async (req, res) => {
    const provider = req.params.provider;
    if (!isProvider(provider)) {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }
    const userId = req.principal!.userId;

    if (!calendar.isLive(provider)) {
      // Demo mode: no external auth. Record a labelled connection and sync.
      repo.connectCalendar(userId, provider, `${provider}-demo`);
      const eventsSynced = await backSync(ctx, userId);
      res.json({ mode: 'demo', connected: true, eventsSynced });
      return;
    }

    if (provider === 'yandex') {
      // Live Yandex is CalDAV + app-password: no redirect, the SPA collects
      // credentials and posts them to POST /connections/yandex/caldav.
      res.json({ mode: 'caldav' });
      return;
    }

    const state = calendarOAuth.buildState(userId, provider);
    const url = calendarOAuth.authorizeUrl(provider, state);
    if (!url) {
      res.status(500).json({ error: 'Provider not configured' });
      return;
    }
    // The SPA calls this with fetch; return the URL so it can redirect the
    // top-level window (a 302 would be opaque to fetch/CORS).
    res.json({ mode: 'oauth', authorizeUrl: url });
  });

  // Connect Yandex Calendar with a login + app-specific password (CalDAV Basic
  // auth). We verify the credential against the CalDAV server (PROPFIND) BEFORE
  // storing it, so a wrong app password is rejected up front rather than failing
  // later during background sync. On success we store the credential (as a
  // 'Basic'-type row in calendar_oauth_tokens: accessToken=app password,
  // accountLogin=login), record the connection, and back-sync.
  router.post('/connections/yandex/caldav', async (req, res) => {
    const userId = req.principal!.userId;
    const cfg = config.calendar.yandex;
    if (!cfg) {
      res.status(409).json({ error: 'Yandex live sync is not enabled on this server (demo mode).' });
      return;
    }
    const body = parseBody(yandexCalDavConnectSchema, req.body, res);
    if (!body) return;

    let ok = false;
    try {
      ok = await YandexCalendarProvider.verifyCredentials(cfg, body.login, body.appPassword);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Yandex CalDAV verification error:', err);
      res.status(502).json({ error: 'Could not reach Yandex CalDAV to verify credentials.' });
      return;
    }
    if (!ok) {
      res.status(401).json({
        error: 'Yandex rejected the login or app password. Use an app password from Yandex ID → App passwords → Calendar.',
      });
      return;
    }

    repo.upsertCalendarToken({
      userId,
      provider: 'yandex',
      accessToken: body.appPassword, // the app password IS the credential
      refreshToken: '',
      tokenType: 'Basic',
      scope: 'caldav',
      accountLogin: body.login,
      expiresAt: 0, // app passwords don't expire until revoked
    });
    repo.connectCalendar(userId, 'yandex', body.login);
    const eventsSynced = await backSync(ctx, userId);
    res.status(201).json({ mode: 'caldav', connected: true, eventsSynced });
  });

  router.delete('/connections/:provider', (req, res) => {
    const provider = req.params.provider;
    if (!isProvider(provider)) {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }
    repo.disconnectCalendar(req.principal!.userId, provider);
    res.json({ ok: true });
  });

  return router;
}

/** Back-sync a user's calendar-enabled subscriptions into their connected calendars. */
async function backSync(ctx: AppContext, userId: string): Promise<number> {
  const { repo, calendar } = ctx;
  let eventsSynced = 0;
  const subs = repo.listSubscriptions(userId).filter((s) => s.calendarSync);
  for (const sub of subs) {
    const subjects =
      sub.kind === 'FRIEND'
        ? [repo.findUserById(sub.targetId)].filter((u): u is NonNullable<typeof u> => Boolean(u))
        : repo.memberIdsOfGroup(sub.targetId).map((id) => repo.findUserById(id)).filter((u): u is NonNullable<typeof u> => Boolean(u));
    const pushed = await calendar.syncSubjects(sub, subjects);
    eventsSynced += pushed.length;
  }
  return eventsSynced;
}
