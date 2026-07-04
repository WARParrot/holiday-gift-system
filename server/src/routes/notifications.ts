import { Router } from 'express';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';

/** In-app notification panel feed + mark-read. The scheduler runs automatically server-side. */
export function notificationRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config, repo));

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

  return router;
}
