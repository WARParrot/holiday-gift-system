import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { subscribeSchema } from './schemas.js';
import type { Subscription, UserRow } from '../types/domain.js';

/**
 * Subscription engine (scenario 2). A user can subscribe to a single FRIEND or
 * a whole GROUP, optionally enabling external-calendar sync. Subscribing pushes
 * recurring birthday events into the connected calendars via CalendarSyncService.
 */
export function subscriptionRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config, calendar } = ctx;
  router.use(requireAuth(config, repo));

  // GET /api/subscriptions — my subscriptions
  router.get('/', (req, res) => {
    res.json({ subscriptions: repo.listSubscriptions(req.principal!.userId) });
  });

  // POST /api/subscriptions — subscribe to a friend or group
  router.post('/', async (req, res) => {
    const body = parseBody(subscribeSchema, req.body, res);
    if (!body) return;
    const me = req.principal!.userId;

    // Validate target existence + prevent self-subscription for friends.
    let subjects: UserRow[] = [];
    if (body.kind === 'FRIEND') {
      const target = repo.findUserById(body.targetId);
      if (!target) {
        res.status(404).json({ error: 'Friend not found' });
        return;
      }
      if (target.id === me) {
        res.status(400).json({ error: 'You cannot subscribe to your own birthday' });
        return;
      }
      subjects = [target];
    } else {
      const group = repo.getGroup(body.targetId);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }
      subjects = repo
        .memberIdsOfGroup(group.id)
        .filter((id) => id !== me)
        .map((id) => repo.findUserById(id))
        .filter((u): u is UserRow => Boolean(u));
    }

    const sub: Subscription = {
      id: randomUUID(),
      subscriberId: me,
      kind: body.kind,
      targetId: body.targetId,
      calendarSync: body.calendarSync,
      createdAt: new Date().toISOString(),
    };
    repo.upsertSubscription(sub);

    const calendarEvents = await calendar.syncSubjects(sub, subjects);
    res.status(201).json({ subscription: sub, calendarEvents });
  });

  // DELETE /api/subscriptions — unsubscribe
  router.delete('/', async (req, res) => {
    const body = parseBody(subscribeSchema, req.body, res);
    if (!body) return;
    const me = req.principal!.userId;
    let subjects: UserRow[] = [];
    if (body.kind === 'FRIEND') {
      const target = repo.findUserById(body.targetId);
      if (target) subjects = [target];
    } else {
      subjects = repo
        .memberIdsOfGroup(body.targetId)
        .map((id) => repo.findUserById(id))
        .filter((u): u is UserRow => Boolean(u));
    }
    const sub: Subscription = {
      id: '',
      subscriberId: me,
      kind: body.kind,
      targetId: body.targetId,
      calendarSync: true,
      createdAt: '',
    };
    await calendar.removeSubjects(sub, subjects);
    repo.removeSubscription(me, body.kind, body.targetId);
    res.json({ ok: true });
  });

  return router;
}
