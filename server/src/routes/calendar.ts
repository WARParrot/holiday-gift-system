import { Router } from 'express';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
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

  // Begin the connect flow. Live providers → redirect to consent; demo
  // providers → record the connection directly and report it.
  router.get('/oauth/:provider/start', async (req, res) => {
    const provider = req.params.provider;
    if (!isProvider(provider)) {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }
    const userId = req.principal!.userId;

    if (!calendar.isLive(provider)) {
      // Demo mode: no external OAuth. Record a labelled connection and sync.
      repo.connectCalendar(userId, provider, `${provider}-demo`);
      const eventsSynced = await backSync(ctx, userId);
      res.json({ mode: 'demo', connected: true, eventsSynced });
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
