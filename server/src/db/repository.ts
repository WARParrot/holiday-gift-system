import type { Database } from 'better-sqlite3';
import type {
  ChatMessage,
  ChatRoom,
  CrowdfundingPool,
  Group,
  GroupMemberView,
  GroupWithMeta,
  Notification,
  PoolContribution,
  PublicUser,
  Role,
  Subscription,
  SubscriptionKind,
  UserRow,
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
        `INSERT INTO users (id, email, password_hash, full_name, birthdate, avatar_url, role, created_at)
         VALUES (@id, @email, @passwordHash, @fullName, @birthdate, @avatarUrl, @role, datetime('now'))`,
      )
      .run(row);
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

  // ---- groups ------------------------------------------------------------
  createGroup(g: Group): void {
    this.db
      .prepare(
        `INSERT INTO groups (id, name, description, visibility, owner_id, created_at)
         VALUES (@id, @name, @description, @visibility, @ownerId, datetime('now'))`,
      )
      .run(g);
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

  listMessages(roomId: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.room_id, m.author_id, m.body, m.created_at, u.full_name AS author_name
         FROM chat_messages m JOIN users u ON u.id = m.author_id
         WHERE m.room_id = ? ORDER BY m.created_at ASC LIMIT 500`,
      )
      .all(roomId) as Record<string, unknown>[];
    return rows.map((r) => this.mapMessage(r));
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
}
