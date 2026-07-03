import { Router } from 'express';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { calendarConnectSchema } from './schemas.js';

/**
 * Calendar connection surface. Backs the profile "Calendar" subpage:
 *  - GET    /api/calendar/connections            → connected providers
 *  - POST   /api/calendar/connections            → connect Google/Yandex
 *  - DELETE /api/calendar/connections/:provider  → disconnect
 *
 * Connecting persists the provider link and back-syncs the user's existing
 * calendar-enabled subscriptions into that provider, so newly connected
 * calendars are populated immediately. The actual event push goes through the
 * CalendarSyncService (recording adapter by default — see calendarSync.ts).
 */
export function calendarRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config, calendar } = ctx;
  router.use(requireAuth(config, repo));

  router.get('/connections', (req, res) => {
    res.json({ connections: repo.listCalendarConnections(req.principal!.userId) });
  });

  router.post('/connections', async (req, res) => {
    const userId = req.principal!.userId;
    const body = parseBody(calendarConnectSchema, req.body, res);
    if (!body) return;

    const connection = repo.connectCalendar(userId, body.provider, body.accountLabel);

    // Back-sync existing calendar-enabled subscriptions into the new provider.
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

    res.status(201).json({ connection, eventsSynced });
  });

  router.delete('/connections/:provider', (req, res) => {
    const provider = req.params.provider;
    if (provider !== 'google' && provider !== 'yandex') {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }
    repo.disconnectCalendar(req.principal!.userId, provider);
    res.json({ ok: true });
  });

  return router;
}
