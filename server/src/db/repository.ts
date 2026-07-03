import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  CalendarConnection,
  CalendarOAuthToken,
  CalendarProviderName,
  CelebrationParticipantView,
  ChatMessage,
  ChatRoom,
  CrowdfundingPool,
  Group,
  GroupMemberView,
  GroupWithMeta,
  Notification,
  ParticipantRole,
  ParticipantSource,
  PoolContribution,
  PublicUser,
  Role,
  Subscription,
  SubscriptionKind,
  UserRow,
  WalletTransaction,
  WalletTxKind,
  WishlistItem,
  WishlistStatus,
} from '../types/domain.js';
import { daysUntilBirthday } from '../util/dates.js';

/**
 * Data-access layer. All SQL lives here so routes/services stay
 * persistence-agnostic and easy to unit test against an in-memory DB.
 */
export class Repository {
  constructor(private readonly db: Database) {}

  // ---- users -------------------------------------------------------------
  createUser(row: UserRow): void {
    this.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, full_name, birthdate, avatar_url, role, balance, created_at)
         VALUES (@id, @email, @passwordHash, @fullName, @birthdate, @avatarUrl, @role, @balance, datetime('now'))`,
      )
      .run({ ...row, balance: row.balance ?? 0 });
  }

  findUserByEmail(email: string): UserRow | undefined {
    return this.mapUser(
      this.db.prepare('SELECT * FROM users WHERE email = ?').get(email),
    );
  }

  findUserById(id: string): UserRow | undefined {
    return this.mapUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }

  updateUserProfile(id: string, fullName: string, birthdate: string, avatarUrl: string | null): void {
    this.db
      .prepare('UPDATE users SET full_name = ?, birthdate = ?, avatar_url = ? WHERE id = ?')
      .run(fullName, birthdate, avatarUrl, id);
  }

  listUsers(): PublicUser[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY full_name').all() as Record<string, unknown>[];
    return rows.map((r) => this.toPublic(this.mapUser(r)!));
  }

  deleteUser(id: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  setUserRole(id: string, role: Role): void {
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  // ---- wallet / payments -------------------------------------------------
  getBalance(userId: string): number {
    const r = this.db.prepare('SELECT balance FROM users WHERE id = ?').get(userId) as { balance: number } | undefined;
    return r?.balance ?? 0;
  }

  /**
   * Apply a signed balance change and record a wallet transaction atomically.
   * Debits (negative amount) are rejected if they would overdraw, unless
   * `allowNegative` is set (admin adjustments may push a balance negative).
   * Returns the resulting transaction, or null if the debit was refused.
   */
  applyWalletTransaction(input: {
    id: string;
    userId: string;
    kind: WalletTxKind;
    amount: number;
    memo?: string;
    txRef: string;
    allowNegative?: boolean;
  }): WalletTransaction | null {
    const tx = this.db.transaction((): WalletTransaction | null => {
      const current = this.getBalance(input.userId);
      const next = Math.round((current + input.amount) * 100) / 100;
      if (next < 0 && !input.allowNegative) return null;
      this.db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(next, input.userId);
      this.db
        .prepare(
          `INSERT INTO wallet_transactions (id, user_id, kind, amount, balance_after, memo, tx_ref, created_at)
           VALUES (@id, @userId, @kind, @amount, @balanceAfter, @memo, @txRef, datetime('now'))`,
        )
        .run({
          id: input.id,
          userId: input.userId,
          kind: input.kind,
          amount: input.amount,
          balanceAfter: next,
          memo: input.memo ?? '',
          txRef: input.txRef,
        });
      return this.getWalletTransaction(input.id)!;
    });
    return tx();
  }

  getWalletTransaction(id: string): WalletTransaction | undefined {
    const r = this.db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? this.mapWalletTx(r) : undefined;
  }

  listWalletTransactions(userId: string, limit = 50): WalletTransaction[] {
    const rows = this.db
      .prepare('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(userId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapWalletTx(r));
  }

  // ---- calendar connections ---------------------------------------------
  listCalendarConnections(userId: string): CalendarConnection[] {
    const rows = this.db
      .prepare('SELECT * FROM calendar_connections WHERE user_id = ? ORDER BY provider')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapCalendarConnection(r));
  }

  connectCalendar(userId: string, provider: CalendarProviderName, accountLabel: string): CalendarConnection {
    this.db
      .prepare(
        `INSERT INTO calendar_connections (user_id, provider, account_label, connected_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, provider) DO UPDATE SET account_label = excluded.account_label,
           connected_at = excluded.connected_at`,
      )
      .run(userId, provider, accountLabel);
    return this.mapCalendarConnection(
      this.db
        .prepare('SELECT * FROM calendar_connections WHERE user_id = ? AND provider = ?')
        .get(userId, provider) as Record<string, unknown>,
    );
  }

  disconnectCalendar(userId: string, provider: CalendarProviderName): void {
    this.db.prepare('DELETE FROM calendar_connections WHERE user_id = ? AND provider = ?').run(userId, provider);
    // Live OAuth tokens are part of the connection; drop them on disconnect.
    this.db.prepare('DELETE FROM calendar_oauth_tokens WHERE user_id = ? AND provider = ?').run(userId, provider);
  }

  // ---- calendar OAuth tokens (live sync) --------------------------------
  /** Insert or replace the stored OAuth token for a (user, provider). */
  upsertCalendarToken(token: {
    userId: string;
    provider: CalendarProviderName;
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    scope: string;
    accountLogin: string;
    expiresAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO calendar_oauth_tokens
           (user_id, provider, access_token, refresh_token, token_type, scope, account_login, expires_at, updated_at)
         VALUES (@userId, @provider, @accessToken, @refreshToken, @tokenType, @scope, @accountLogin, @expiresAt, datetime('now'))
         ON CONFLICT(user_id, provider) DO UPDATE SET
           access_token = excluded.access_token,
           -- keep the existing refresh token if the provider didn't return a new one
           refresh_token = CASE WHEN excluded.refresh_token = '' THEN calendar_oauth_tokens.refresh_token ELSE excluded.refresh_token END,
           token_type = excluded.token_type,
           scope = excluded.scope,
           account_login = excluded.account_login,
           expires_at = excluded.expires_at,
           updated_at = datetime('now')`,
      )
      .run(token);
  }

  getCalendarToken(userId: string, provider: CalendarProviderName): CalendarOAuthToken | undefined {
    const r = this.db
      .prepare('SELECT * FROM calendar_oauth_tokens WHERE user_id = ? AND provider = ?')
      .get(userId, provider) as Record<string, unknown> | undefined;
    return r ? this.mapCalendarToken(r) : undefined;
  }

  /** Update just the access token + expiry after a refresh. */
  updateCalendarAccessToken(userId: string, provider: CalendarProviderName, accessToken: string, expiresAt: number): void {
    this.db
      .prepare(
        "UPDATE calendar_oauth_tokens SET access_token = ?, expires_at = ?, updated_at = datetime('now') WHERE user_id = ? AND provider = ?",
      )
      .run(accessToken, expiresAt, userId, provider);
  }

  private mapCalendarToken(r: Record<string, unknown>): CalendarOAuthToken {
    return {
      userId: r.user_id as string,
      provider: r.provider as CalendarProviderName,
      accessToken: r.access_token as string,
      refreshToken: (r.refresh_token as string) ?? '',
      tokenType: (r.token_type as string) ?? 'Bearer',
      scope: (r.scope as string) ?? '',
      accountLogin: (r.account_login as string) ?? '',
      expiresAt: (r.expires_at as number) ?? 0,
      updatedAt: r.updated_at as string,
    };
  }

  // ---- groups ------------------------------------------------------------
  createGroup(g: Group): void {
    this.db
      .prepare(
        `INSERT INTO groups (id, name, description, visibility, owner_id, created_at)
         VALUES (@id, @name, @description, @visibility, @ownerId, datetime('now'))`,
      )
      .run(g);
  }

  updateGroup(id: string, fields: { name: string; description: string; visibility: Group['visibility']; ownerId?: string }): void {
    if (fields.ownerId) {
      this.db
        .prepare('UPDATE groups SET name = ?, description = ?, visibility = ?, owner_id = ? WHERE id = ?')
        .run(fields.name, fields.description, fields.visibility, fields.ownerId, id);
    } else {
      this.db
        .prepare('UPDATE groups SET name = ?, description = ?, visibility = ? WHERE id = ?')
        .run(fields.name, fields.description, fields.visibility, id);
    }
  }

  addMember(groupId: string, userId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)')
      .run(groupId, userId);
  }

  removeMember(groupId: string, userId: string): void {
    this.db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
  }

  isMember(groupId: string, userId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(groupId, userId);
    return Boolean(row);
  }

  getGroup(id: string): Group | undefined {
    const r = this.db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.mapGroup(r) : undefined;
  }

  listGroups(viewerId: string): GroupWithMeta[] {
    const rows = this.db.prepare('SELECT * FROM groups ORDER BY name').all() as Record<string, unknown>[];
    return rows.map((r) => {
      const g = this.mapGroup(r);
      const memberCount = (
        this.db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(g.id) as { c: number }
      ).c;
      return { ...g, memberCount, isMember: this.isMember(g.id, viewerId) };
    });
  }

  listGroupsForUser(userId: string): Group[] {
    const rows = this.db
      .prepare(
        `SELECT g.* FROM groups g
         JOIN group_members m ON m.group_id = g.id
         WHERE m.user_id = ? ORDER BY g.name`,
      )
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapGroup(r));
  }

  listGroupMembers(groupId: string): GroupMemberView[] {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.full_name, u.avatar_url, u.birthdate
         FROM users u JOIN group_members m ON m.user_id = u.id
         WHERE m.group_id = ?`,
      )
      .all(groupId) as { id: string; full_name: string; avatar_url: string | null; birthdate: string }[];
    return rows
      .map((r) => ({
        userId: r.id,
        fullName: r.full_name,
        avatarUrl: r.avatar_url,
        birthdate: r.birthdate,
        daysUntilBirthday: daysUntilBirthday(r.birthdate),
      }))
      .sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);
  }

  memberIdsOfGroup(groupId: string): string[] {
    const rows = this.db
      .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
      .all(groupId) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  deleteGroup(id: string): void {
    this.db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  }

  // ---- wishlist ----------------------------------------------------------
  createWishlistItem(item: WishlistItem): void {
    this.db
      .prepare(
        `INSERT INTO wishlist_items (id, owner_id, title, description, link, price_min, price_max, status, created_at)
         VALUES (@id, @ownerId, @title, @description, @link, @priceMin, @priceMax, @status, datetime('now'))`,
      )
      .run(item);
  }

  listWishlist(ownerId: string): WishlistItem[] {
    const rows = this.db
      .prepare('SELECT * FROM wishlist_items WHERE owner_id = ? ORDER BY created_at DESC')
      .all(ownerId) as Record<string, unknown>[];
    return rows.map((r) => this.mapWishlist(r));
  }

  getWishlistItem(id: string): WishlistItem | undefined {
    const r = this.db.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.mapWishlist(r) : undefined;
  }

  updateWishlistItem(item: WishlistItem): void {
    this.db
      .prepare(
        `UPDATE wishlist_items SET title=@title, description=@description, link=@link,
         price_min=@priceMin, price_max=@priceMax, status=@status WHERE id=@id`,
      )
      .run(item);
  }

  deleteWishlistItem(id: string): void {
    this.db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(id);
  }

  setWishlistStatus(id: string, status: WishlistStatus): void {
    this.db.prepare('UPDATE wishlist_items SET status = ? WHERE id = ?').run(status, id);
  }

  // ---- subscriptions -----------------------------------------------------
  upsertSubscription(sub: Subscription): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (id, subscriber_id, kind, target_id, calendar_sync, created_at)
         VALUES (@id, @subscriberId, @kind, @targetId, @calendarSync, datetime('now'))
         ON CONFLICT(subscriber_id, kind, target_id)
         DO UPDATE SET calendar_sync = excluded.calendar_sync`,
      )
      .run({ ...sub, calendarSync: sub.calendarSync ? 1 : 0 });
  }

  removeSubscription(subscriberId: string, kind: SubscriptionKind, targetId: string): void {
    this.db
      .prepare('DELETE FROM subscriptions WHERE subscriber_id = ? AND kind = ? AND target_id = ?')
      .run(subscriberId, kind, targetId);
  }

  listSubscriptions(subscriberId: string): Subscription[] {
    const rows = this.db
      .prepare('SELECT * FROM subscriptions WHERE subscriber_id = ?')
      .all(subscriberId) as Record<string, unknown>[];
    return rows.map((r) => this.mapSubscription(r));
  }

  /**
   * How (if at all) `subscriberId` is subscribed to `subjectId`. Returns the
   * source ('FRIEND' for a direct friend subscription, 'GROUP' for a shared
   * group subscription) or null when there is no relationship. Used to decide
   * chat-join eligibility under the positive-authorization model.
   */
  subscriptionSourceFor(subscriberId: string, subjectId: string): ParticipantSource | null {
    if (subscriberId === subjectId) return null;
    const direct = this.db
      .prepare(
        "SELECT 1 FROM subscriptions WHERE subscriber_id = ? AND kind = 'FRIEND' AND target_id = ?",
      )
      .get(subscriberId, subjectId);
    if (direct) return 'FRIEND';
    const viaGroup = this.db
      .prepare(
        `SELECT 1 FROM subscriptions s
         JOIN group_members m ON m.group_id = s.target_id
         WHERE s.subscriber_id = ? AND s.kind = 'GROUP' AND m.user_id = ? LIMIT 1`,
      )
      .get(subscriberId, subjectId);
    if (viaGroup) return 'GROUP';
    return null;
  }

  /** All subscriber ids that will be notified about a given subject user. */
  subscriberIdsForSubject(subjectId: string): string[] {
    const direct = this.db
      .prepare("SELECT subscriber_id FROM subscriptions WHERE kind = 'FRIEND' AND target_id = ?")
      .all(subjectId) as { subscriber_id: string }[];
    const viaGroup = this.db
      .prepare(
        `SELECT DISTINCT s.subscriber_id
         FROM subscriptions s
         JOIN group_members m ON m.group_id = s.target_id
         WHERE s.kind = 'GROUP' AND m.user_id = ?`,
      )
      .all(subjectId) as { subscriber_id: string }[];
    const ids = new Set<string>();
    for (const r of direct) ids.add(r.subscriber_id);
    for (const r of viaGroup) ids.add(r.subscriber_id);
    // The subject is NEVER a subscriber to their own celebration.
    ids.delete(subjectId);
    return [...ids];
  }

  // ---- notifications -----------------------------------------------------
  createNotification(n: Notification & { dedupeKey?: string }): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, type, title, body, data, read, dedupe_key, created_at)
         VALUES (@id, @userId, @type, @title, @body, @data, 0, @dedupeKey, datetime('now'))`,
      )
      .run({
        id: n.id,
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.body,
        data: JSON.stringify(n.data ?? {}),
        dedupeKey: n.dedupeKey ?? null,
      });
    return res.changes > 0;
  }

  listNotifications(userId: string): Notification[] {
    const rows = this.db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapNotification(r));
  }

  markNotificationRead(id: string, userId: string): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  }

  markAllNotificationsRead(userId: string): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
  }

  /** Look up a single notification by its (user, dedupe_key) pair, or undefined. */
  findNotificationByDedupe(userId: string, dedupeKey: string): Notification | undefined {
    const r = this.db
      .prepare('SELECT * FROM notifications WHERE user_id = ? AND dedupe_key = ?')
      .get(userId, dedupeKey) as Record<string, unknown> | undefined;
    return r ? this.mapNotification(r) : undefined;
  }

  /**
   * Delete the notification identified by (user, dedupe_key), if any. Returns
   * the removed id so callers can push a live "removed" frame. Used to clear a
   * user's own chat-counter notification once they post in that room.
   */
  deleteNotificationByDedupe(userId: string, dedupeKey: string): string | undefined {
    const row = this.db
      .prepare('SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?')
      .get(userId, dedupeKey) as { id: string } | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM notifications WHERE id = ?').run(row.id);
    return row.id;
  }

  /**
   * Refresh an existing notification in place: overwrite its title/body/data,
   * re-mark it unread and bump `created_at` to now so it resurfaces at the top
   * of the feed. Used to collapse a burst of chat messages into one counter row.
   */
  refreshNotification(id: string, title: string, body: string, data: Record<string, unknown>): void {
    this.db
      .prepare(
        "UPDATE notifications SET title = ?, body = ?, data = ?, read = 0, created_at = datetime('now') WHERE id = ?",
      )
      .run(title, body, JSON.stringify(data ?? {}), id);
  }

  /**
   * Run a set of writes inside a single transaction so they commit (and fsync)
   * once instead of per-statement. Used to collapse the per-recipient
   * notification fan-out into one commit.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---- chat rooms --------------------------------------------------------
  getOrCreateRoomForSubject(subjectId: string, roomId: string): ChatRoom {
    const existing = this.db
      .prepare('SELECT * FROM chat_rooms WHERE subject_id = ?')
      .get(subjectId) as Record<string, unknown> | undefined;
    if (existing) return this.mapRoom(existing);
    this.db
      .prepare("INSERT INTO chat_rooms (id, subject_id, created_at) VALUES (?, ?, datetime('now'))")
      .run(roomId, subjectId);
    return this.mapRoom(
      this.db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId) as Record<string, unknown>,
    );
  }

  getRoomById(roomId: string): ChatRoom | undefined {
    const r = this.db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId) as Record<string, unknown> | undefined;
    return r ? this.mapRoom(r) : undefined;
  }

  /** Look up an existing room for a subject without creating one. */
  getRoomBySubject(subjectId: string): ChatRoom | undefined {
    const r = this.db
      .prepare('SELECT * FROM chat_rooms WHERE subject_id = ?')
      .get(subjectId) as Record<string, unknown> | undefined;
    return r ? this.mapRoom(r) : undefined;
  }

  addMessage(msg: { id: string; roomId: string; authorId: string; body: string }): ChatMessage {
    this.db
      .prepare(
        "INSERT INTO chat_messages (id, room_id, author_id, body, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
      )
      .run(msg.id, msg.roomId, msg.authorId, msg.body);
    return this.getMessage(msg.id)!;
  }

  getMessage(id: string): ChatMessage | undefined {
    const r = this.db
      .prepare(
        `SELECT m.id, m.room_id, m.author_id, m.body, m.created_at, u.full_name AS author_name
         FROM chat_messages m JOIN users u ON u.id = m.author_id WHERE m.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return r ? this.mapMessage(r) : undefined;
  }

  listMessages(roomId: string, opts: { limit?: number; before?: string } = {}): ChatMessage[] {
    // Cursor pagination keyed on the monotonic rowid (insertion order ==
    // chronological order), NOT on created_at — created_at has only
    // second-resolution and ties within a burst would drop or duplicate rows.
    // `before` is a message id from an earlier page; we page rows with a
    // smaller rowid (i.e. strictly older). We fetch newest-first for the cursor
    // to work, then return the page in chronological (ASC) order.
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    let beforeRowid: number | null = null;
    if (opts.before) {
      const cursorRow = this.db
        .prepare('SELECT rowid AS rid FROM chat_messages WHERE id = ? AND room_id = ?')
        .get(opts.before, roomId) as { rid: number } | undefined;
      // Unknown cursor → treat as "from the newest" rather than leaking rows.
      if (!cursorRow) return [];
      beforeRowid = cursorRow.rid;
    }
    const rows = (
      beforeRowid !== null
        ? this.db
            .prepare(
              `SELECT m.id, m.room_id, m.author_id, m.body, m.created_at, u.full_name AS author_name
               FROM chat_messages m JOIN users u ON u.id = m.author_id
               WHERE m.room_id = ? AND m.rowid < ?
               ORDER BY m.rowid DESC LIMIT ?`,
            )
            .all(roomId, beforeRowid, limit)
        : this.db
            .prepare(
              `SELECT m.id, m.room_id, m.author_id, m.body, m.created_at, u.full_name AS author_name
               FROM chat_messages m JOIN users u ON u.id = m.author_id
               WHERE m.room_id = ?
               ORDER BY m.rowid DESC LIMIT ?`,
            )
            .all(roomId, limit)
    ) as Record<string, unknown>[];
    return rows.map((r) => this.mapMessage(r)).reverse();
  }

  // ---- chat participants (positive authorization) -----------------------
  /**
   * Add a user to a room's participant allowlist (idempotent). This is the
   * single grant that authorizes read/post access. `role` defaults to
   * PARTICIPANT; the first organizer to open a room is recorded as ORGANIZER.
   */
  addParticipant(
    roomId: string,
    userId: string,
    role: ParticipantRole = 'PARTICIPANT',
    source: ParticipantSource = 'FRIEND',
  ): void {
    this.db
      .prepare(
        `INSERT INTO chat_participants (room_id, user_id, role, source, joined_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(room_id, user_id) DO NOTHING`,
      )
      .run(roomId, userId, role, source);
  }

  removeParticipant(roomId: string, userId: string): void {
    this.db.prepare('DELETE FROM chat_participants WHERE room_id = ? AND user_id = ?').run(roomId, userId);
  }

  /** True iff the user holds an explicit participant grant for the room. */
  isParticipant(roomId: string, userId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM chat_participants WHERE room_id = ? AND user_id = ?')
      .get(roomId, userId);
    return Boolean(row);
  }

  listParticipants(roomId: string): CelebrationParticipantView[] {
    const rows = this.db
      .prepare(
        `SELECT p.room_id, p.user_id, p.role, p.source, p.joined_at,
                u.full_name AS full_name, u.avatar_url AS avatar_url
         FROM chat_participants p JOIN users u ON u.id = p.user_id
         WHERE p.room_id = ? ORDER BY p.joined_at ASC`,
      )
      .all(roomId) as Record<string, unknown>[];
    return rows.map((r) => ({
      roomId: r.room_id as string,
      userId: r.user_id as string,
      role: r.role as ParticipantRole,
      source: r.source as ParticipantSource,
      joinedAt: r.joined_at as string,
      fullName: r.full_name as string,
      avatarUrl: (r.avatar_url as string) ?? null,
    }));
  }

  // ---- crowdfunding ------------------------------------------------------
  createPool(pool: CrowdfundingPool & { cycleKey: string }): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO crowdfunding_pools
         (id, subject_id, room_id, target_amount, current_balance, status, cycle_key, opened_at)
         VALUES (@id, @subjectId, @roomId, @targetAmount, 0, 'OPEN', @cycleKey, datetime('now'))`,
      )
      .run({
        id: pool.id,
        subjectId: pool.subjectId,
        roomId: pool.roomId,
        targetAmount: pool.targetAmount,
        cycleKey: pool.cycleKey,
      });
    return res.changes > 0;
  }

  getPoolByRoom(roomId: string): CrowdfundingPool | undefined {
    const r = this.db
      .prepare(
        `SELECT p.*, u.full_name AS subject_name FROM crowdfunding_pools p
         JOIN users u ON u.id = p.subject_id WHERE p.room_id = ? AND p.status = 'OPEN'
         ORDER BY p.opened_at DESC LIMIT 1`,
      )
      .get(roomId) as Record<string, unknown> | undefined;
    return r ? this.mapPool(r) : undefined;
  }

  getPoolById(poolId: string): CrowdfundingPool | undefined {
    const r = this.db
      .prepare(
        `SELECT p.*, u.full_name AS subject_name FROM crowdfunding_pools p
         JOIN users u ON u.id = p.subject_id WHERE p.id = ?`,
      )
      .get(poolId) as Record<string, unknown> | undefined;
    return r ? this.mapPool(r) : undefined;
  }

  /** Admin: every pool (any status) with its subject name, newest first. */
  listAllPools(): CrowdfundingPool[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, u.full_name AS subject_name FROM crowdfunding_pools p
         JOIN users u ON u.id = p.subject_id ORDER BY p.opened_at DESC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapPool(r));
  }

  /**
   * Admin: update a pool's target/status, and (when the balance changes) record
   * a reconciling ADMIN adjustment in `pool_contributions` so the pool balance
   * always equals the sum of its contribution trail — no silent direct writes.
   * `adminId` is attributed as the contributor of the adjustment row.
   */
  updatePoolFinance(
    poolId: string,
    fields: { targetAmount: number; currentBalance: number; status: CrowdfundingPool['status'] },
    adminId: string,
  ): CrowdfundingPool | undefined {
    const tx = this.db.transaction(() => {
      const current = this.getPoolById(poolId);
      if (!current) return;
      // Target + status are metadata: set directly.
      this.db
        .prepare('UPDATE crowdfunding_pools SET target_amount = ?, status = ? WHERE id = ?')
        .run(fields.targetAmount, fields.status, poolId);
      // Balance: only move it via a recorded adjustment so the ledger stays the
      // source of truth. Rounded to cents to match monetary handling elsewhere.
      const delta = Math.round((fields.currentBalance - current.currentBalance) * 100) / 100;
      if (delta !== 0) {
        this.db
          .prepare(
            `INSERT INTO pool_contributions (id, pool_id, contributor_id, amount, tx_ref, created_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(randomUUID(), poolId, adminId, delta, `ADMIN-ADJ-${Date.now().toString(36).toUpperCase()}`);
        this.db
          .prepare('UPDATE crowdfunding_pools SET current_balance = current_balance + ? WHERE id = ?')
          .run(delta, poolId);
      }
    });
    tx();
    return this.getPoolById(poolId);
  }

  addContribution(c: PoolContribution): CrowdfundingPool {
    const tx = this.db.transaction((contribution: PoolContribution) => {
      this.db
        .prepare(
          `INSERT INTO pool_contributions (id, pool_id, contributor_id, amount, tx_ref, created_at)
           VALUES (@id, @poolId, @contributorId, @amount, @txRef, datetime('now'))`,
        )
        .run({
          id: contribution.id,
          poolId: contribution.poolId,
          contributorId: contribution.contributorId,
          amount: contribution.amount,
          txRef: contribution.txRef,
        });
      this.db
        .prepare('UPDATE crowdfunding_pools SET current_balance = current_balance + ? WHERE id = ?')
        .run(contribution.amount, contribution.poolId);
    });
    tx(c);
    return this.getPoolById(c.poolId)!;
  }

  listContributions(poolId: string): PoolContribution[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, u.full_name AS contributor_name FROM pool_contributions c
         JOIN users u ON u.id = c.contributor_id WHERE c.pool_id = ? ORDER BY c.created_at ASC`,
      )
      .all(poolId) as Record<string, unknown>[];
    return rows.map((r) => this.mapContribution(r));
  }

  /** All users with an upcoming birthday exactly `days` away. */
  usersWithBirthdayInDays(days: number): UserRow[] {
    const all = this.db.prepare('SELECT * FROM users').all() as Record<string, unknown>[];
    return all.map((r) => this.mapUser(r)!).filter((u) => daysUntilBirthday(u.birthdate) === days);
  }

  allUsers(): UserRow[] {
    const rows = this.db.prepare('SELECT * FROM users').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapUser(r)!);
  }

  // ---- mappers -----------------------------------------------------------
  toPublic(u: UserRow): PublicUser {
    const { passwordHash: _ignored, ...pub } = u;
    void _ignored;
    return pub;
  }

  private mapUser(r: unknown): UserRow | undefined {
    if (!r) return undefined;
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      email: row.email as string,
      passwordHash: row.password_hash as string,
      fullName: row.full_name as string,
      birthdate: row.birthdate as string,
      avatarUrl: (row.avatar_url as string) ?? null,
      role: row.role as Role,
      balance: (row.balance as number) ?? 0,
      createdAt: row.created_at as string,
    };
  }

  private mapGroup(r: Record<string, unknown>): Group {
    return {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      visibility: r.visibility as Group['visibility'],
      ownerId: r.owner_id as string,
      createdAt: r.created_at as string,
    };
  }

  private mapWishlist(r: Record<string, unknown>): WishlistItem {
    return {
      id: r.id as string,
      ownerId: r.owner_id as string,
      title: r.title as string,
      description: r.description as string,
      link: (r.link as string) ?? null,
      priceMin: (r.price_min as number) ?? null,
      priceMax: (r.price_max as number) ?? null,
      status: r.status as WishlistStatus,
      createdAt: r.created_at as string,
    };
  }

  private mapSubscription(r: Record<string, unknown>): Subscription {
    return {
      id: r.id as string,
      subscriberId: r.subscriber_id as string,
      kind: r.kind as SubscriptionKind,
      targetId: r.target_id as string,
      calendarSync: Boolean(r.calendar_sync),
      createdAt: r.created_at as string,
    };
  }

  private mapNotification(r: Record<string, unknown>): Notification {
    return {
      id: r.id as string,
      userId: r.user_id as string,
      type: r.type as Notification['type'],
      title: r.title as string,
      body: r.body as string,
      data: JSON.parse((r.data as string) || '{}'),
      read: Boolean(r.read),
      createdAt: r.created_at as string,
    };
  }

  private mapRoom(r: Record<string, unknown>): ChatRoom {
    const subject = this.findUserById(r.subject_id as string);
    return {
      id: r.id as string,
      subjectId: r.subject_id as string,
      subjectName: subject?.fullName ?? 'Unknown',
      createdAt: r.created_at as string,
    };
  }

  private mapMessage(r: Record<string, unknown>): ChatMessage {
    return {
      id: r.id as string,
      roomId: r.room_id as string,
      authorId: r.author_id as string,
      authorName: r.author_name as string,
      body: r.body as string,
      createdAt: r.created_at as string,
    };
  }

  private mapPool(r: Record<string, unknown>): CrowdfundingPool {
    return {
      id: r.id as string,
      subjectId: r.subject_id as string,
      subjectName: (r.subject_name as string) ?? 'Unknown',
      roomId: r.room_id as string,
      targetAmount: r.target_amount as number,
      currentBalance: r.current_balance as number,
      status: r.status as CrowdfundingPool['status'],
      openedAt: r.opened_at as string,
    };
  }

  private mapContribution(r: Record<string, unknown>): PoolContribution {
    return {
      id: r.id as string,
      poolId: r.pool_id as string,
      contributorId: r.contributor_id as string,
      contributorName: (r.contributor_name as string) ?? 'Unknown',
      amount: r.amount as number,
      txRef: r.tx_ref as string,
      createdAt: r.created_at as string,
    };
  }

  private mapWalletTx(r: Record<string, unknown>): WalletTransaction {
    return {
      id: r.id as string,
      userId: r.user_id as string,
      kind: r.kind as WalletTxKind,
      amount: r.amount as number,
      balanceAfter: r.balance_after as number,
      memo: r.memo as string,
      txRef: r.tx_ref as string,
      createdAt: r.created_at as string,
    };
  }

  private mapCalendarConnection(r: Record<string, unknown>): CalendarConnection {
    return {
      userId: r.user_id as string,
      provider: r.provider as CalendarProviderName,
      accountLabel: (r.account_label as string) ?? '',
      connectedAt: r.connected_at as string,
    };
  }
}
