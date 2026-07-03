import { Router } from 'express';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';

/** In-app notification panel feed + mark-read + a demo scheduler trigger. */
export function notificationRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config, notifications } = ctx;
  router.use(requireAuth(config));

  // GET /api/notifications
  router.get('/', (req, res) => {
    const list = repo.listNotifications(req.principal!.userId);
    res.json({ notifications: list, unread: list.filter((n) => !n.read).length });
  });

  // POST /api/notifications/:id/read
  router.post('/:id/read', (req, res) => {
    repo.markNotificationRead(req.params.id, req.principal!.userId);
    res.json({ ok: true });
  });

  // POST /api/notifications/read-all
  router.post('/read-all', (req, res) => {
    repo.markAllNotificationsRead(req.principal!.userId);
    res.json({ ok: true });
  });

  // POST /api/notifications/run-scheduler — manual tick (useful for demos/tests)
  router.post('/run-scheduler', (_req, res) => {
    const result = notifications.runTick();
    res.json(result);
  });

  return router;
}
