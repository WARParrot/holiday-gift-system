import express, { type Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import type { AppConfig } from './config.js';
import type { Repository } from './db/repository.js';
import { NotificationService, type NotificationSink, type PoolSink } from './services/notifications.js';
import { CalendarSyncService, RecordingCalendarProvider } from './services/calendarSync.js';
import type { AppContext } from './routes/context.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { groupRoutes } from './routes/groups.js';
import { wishlistRoutes } from './routes/wishlist.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { notificationRoutes } from './routes/notifications.js';
import { chatRoutes } from './routes/chat.js';
import { paymentRoutes } from './routes/payments.js';
import { calendarRoutes } from './routes/calendar.js';
import { adminRoutes } from './routes/admin.js';

export interface BuildAppResult {
  app: Express;
  ctx: AppContext;
}

/**
 * Assemble the Express app + dependency context. The ChatHub is attached later
 * (after the HTTP server exists) via `ctx.hub.current`.
 */
export function buildApp(
  config: AppConfig,
  repo: Repository,
  hooks: { onNotify?: NotificationSink; onPool?: PoolSink } = {},
): BuildAppResult {
  const calendar = new CalendarSyncService([
    new RecordingCalendarProvider('google'),
    new RecordingCalendarProvider('yandex'),
  ]);
  const notifications = new NotificationService(repo, config, hooks.onNotify, hooks.onPool);
  const ctx: AppContext = { config, repo, notifications, calendar, hub: { current: null } };

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'bcms', time: new Date().toISOString() }));

  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/users', userRoutes(ctx));
  app.use('/api/groups', groupRoutes(ctx));
  app.use('/api/wishlist', wishlistRoutes(ctx));
  app.use('/api/subscriptions', subscriptionRoutes(ctx));
  app.use('/api/notifications', notificationRoutes(ctx));
  app.use('/api/chat', chatRoutes(ctx));
  app.use('/api/payments', paymentRoutes(ctx));
  app.use('/api/calendar', calendarRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));

  // Optional: serve the built SPA as a single process (production convenience).
  // In development the Vite dev server proxies /api and /ws instead.
  if (config.webDist) {
    const indexHtml = path.join(config.webDist, 'index.html');
    app.use(express.static(config.webDist));
    // SPA fallback: any non-API GET returns index.html for client-side routing.
    app.get(/^(?!\/api\/|\/ws).*/, (_req, res) => res.sendFile(indexHtml));
  }

  // Central error handler — never leak stack traces to clients.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, ctx };
}
