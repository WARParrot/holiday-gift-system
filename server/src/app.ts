import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import path from 'node:path';
import type { AppConfig } from './config.js';
import type { Repository } from './db/repository.js';
import { NotificationService, type NotificationSink, type PoolSink } from './services/notifications.js';
import { CalendarSyncService, type CalendarProvider } from './services/calendarSync.js';
import { CalendarOAuthService } from './services/calendarOAuth.js';
import type { CalendarProviderName } from './types/domain.js';
import type { AppContext } from './routes/context.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { groupRoutes } from './routes/groups.js';
import { wishlistRoutes } from './routes/wishlist.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { friendRoutes } from './routes/friends.js';
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
 * Build a CORS options object from the configured allowlist.
 *   - empty list  → same-origin only (no CORS headers emitted);
 *   - ['*']       → reflect any origin (dev convenience);
 *   - otherwise   → reflect only listed origins, reject the rest.
 */
function buildCorsOptions(origins: string[]): CorsOptions | false {
  if (origins.length === 0) return false; // same-origin: don't mount CORS at all
  if (origins.includes('*')) return { origin: true };
  return {
    origin(origin, callback) {
      // Allow same-origin / non-browser clients (no Origin header) and any
      // explicitly allowlisted origin; reject everything else.
      if (!origin || origins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Origin not allowed by CORS'));
      }
    },
  };
}

/**
 * Assemble the Express app + dependency context. The ChatHub is attached later
 * (after the HTTP server exists) via `ctx.hub.current`.
 */
export function buildApp(
  config: AppConfig,
  repo: Repository,
  hooks: {
    onNotify?: NotificationSink;
    onPool?: PoolSink;
    /** Test hook: inject recording/mock calendar adapters per provider. */
    calendarProviders?: Partial<Record<CalendarProviderName, CalendarProvider>>;
  } = {},
): BuildAppResult {
  const calendarOAuth = new CalendarOAuthService(config, repo);
  const calendar = new CalendarSyncService({
    repo,
    config,
    oauth: calendarOAuth,
    providers: hooks.calendarProviders,
  });
  const notifications = new NotificationService(repo, config, hooks.onNotify, hooks.onPool);
  const ctx: AppContext = { config, repo, notifications, calendar, calendarOAuth, hub: { current: null } };

  const app = express();
  // Honour X-Forwarded-For when running behind a proxy so rate-limit keying and
  // req.ip reflect the real client rather than the proxy hop.
  app.set('trust proxy', 1);

  // CORS: locked down to the configured allowlist (default same-origin only)
  // instead of a wide-open `cors()`.
  const corsOptions = buildCorsOptions(config.corsOrigins);
  if (corsOptions) app.use(cors(corsOptions));

  app.use(express.json({ limit: '2mb' }));

  // Rate limiting: a general per-IP cap on the whole API, plus a much stricter
  // cap on the auth endpoints to blunt credential brute-forcing.
  const generalLimiter = createRateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max });
  const authLimiter = createRateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.authMax, label: 'auth' });
  app.use('/api/', generalLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'bcms', time: new Date().toISOString() }));

  app.use('/api/auth', authLimiter, authRoutes(ctx));
  app.use('/api/users', userRoutes(ctx));
  app.use('/api/groups', groupRoutes(ctx));
  app.use('/api/wishlist', wishlistRoutes(ctx));
  app.use('/api/subscriptions', subscriptionRoutes(ctx));
  app.use('/api/friends', friendRoutes(ctx));
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
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return { app, ctx };
}
