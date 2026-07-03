import type { AppConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { NotificationService } from '../services/notifications.js';
import type { CalendarSyncService } from '../services/calendarSync.js';
import type { ChatHub } from '../ws/chatHub.js';

/**
 * Dependency container passed to every route factory. The ChatHub is set after
 * the HTTP server is created (routes only need it to publish pool updates), so
 * it's a mutable holder rather than a constructor arg.
 */
export interface AppContext {
  config: AppConfig;
  repo: Repository;
  notifications: NotificationService;
  calendar: CalendarSyncService;
  hub: { current: ChatHub | null };
}
