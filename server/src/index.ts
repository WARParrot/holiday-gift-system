import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db/schema.js';
import { Repository } from './db/repository.js';
import { buildApp } from './app.js';
import { ChatHub } from './ws/chatHub.js';

const config = loadConfig();

// Auto-detect the built SPA (../web/dist) when WEB_DIST isn't explicitly set,
// so `npm start` can serve the whole app from one process after both builds.
if (!config.webDist) {
  const guess = path.resolve(process.cwd(), '..', 'web', 'dist');
  if (fs.existsSync(path.join(guess, 'index.html'))) {
    config.webDist = guess;
  }
}

// Ensure the data directory exists for file-backed SQLite.
if (config.dbFile !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
}

const db = openDatabase(config.dbFile);
const repo = new Repository(db);

// Wire live push: notifications and pool updates flow to connected sockets.
const { app, ctx } = buildApp(config, repo, {
  onNotify: (userId, notification) => {
    // Push the new/updated notification to the user's connected sockets so the
    // bell updates live. The REST feed stays authoritative; the client can
    // refresh on receipt (the poll remains as a fallback if no socket is open).
    ctx.hub.current?.publishNotification(userId, notification);
  },
  onPool: (pool) => ctx.hub.current?.publishPool(pool),
});

const server = createServer(app);
const hub = new ChatHub(server, repo, config, ctx.notifications);
ctx.hub.current = hub;

// Background scheduler: reminders + auto-opening crowdfunding pools.
if (config.enableScheduler) {
  const tick = () => {
    try {
      const result = ctx.notifications.runTick();
      if (result.reminders || result.pools) {
        // eslint-disable-next-line no-console
        console.log(`[scheduler] reminders=${result.reminders} pools=${result.pools}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[scheduler] tick failed:', err);
    }
  };
  tick();
  setInterval(tick, config.schedulerIntervalMs).unref();
}

server.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`BCMS server listening on http://${config.host}:${config.port} (REST + WS /ws)`);
});
