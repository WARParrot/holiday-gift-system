import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { ChatMessage, ChatRoom, CrowdfundingPool, Notification } from '../types/domain.js';
import { daysUntilBirthday, nextBirthdayYear } from '../util/dates.js';

/**
 * Notification + scheduling engine.
 *
 * Responsibilities:
 *  - Emit reminder notifications at configured offsets (7/3/1 days) before a
 *    subject's birthday, to every subscriber (direct or via group).
 *  - Auto-open a crowdfunding pool `poolLeadDays` before a birthday and post a
 *    POOL_OPENED notification.
 *
 * Idempotency: every reminder/pool has a `dedupeKey` (subject + cycle year +
 * offset). The UNIQUE(user_id, dedupe_key) constraint means running the tick
 * repeatedly on the same day never produces duplicates.
 */
export type NotificationSink = (userId: string, n: Notification) => void;
export type PoolSink = (pool: CrowdfundingPool) => void;

/** Russian plural for "день/дня/дней" given a day count. */
function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

export class NotificationService {
  constructor(
    private readonly repo: Repository,
    private readonly config: AppConfig,
    private readonly onNotify: NotificationSink = () => {},
    private readonly onPool: PoolSink = () => {},
  ) {}

  /** Push a one-off notification to a user (used by chat mentions, etc.). Returns true if newly created. */
  push(userId: string, type: Notification['type'], title: string, body: string, data: Record<string, unknown> = {}, dedupeKey?: string): boolean {
    const n: Notification = {
      id: randomUUID(),
      userId,
      type,
      title,
      body,
      data,
      read: false,
      createdAt: new Date().toISOString(),
    };
    const created = this.repo.createNotification({ ...n, dedupeKey });
    if (created) this.onNotify(userId, n);
    return created;
  }

  /**
   * Record a new chat message for one subscriber.
   *
   * Instead of stacking a fresh row per message, all messages in a room
   * collapse into a single CHAT_MESSAGE notification keyed by `chat:<roomId>`:
   *  - the first unread message creates it (count = 1);
   *  - each following message bumps its counter ("N new messages in …");
   *  - once the recipient has read it, the next message starts a fresh count.
   *
   * The live sink fires on every message (create or bump) so a connected
   * client's bell updates immediately instead of waiting for the next poll.
   */
  pushChatMessage(userId: string, room: ChatRoom, message: ChatMessage): void {
    const dedupeKey = `chat:${room.id}`;
    const preview = `${message.authorName}: ${message.body.slice(0, 80)}`;
    const existing = this.repo.findNotificationByDedupe(userId, dedupeKey);

    if (!existing) {
      this.push(
        userId,
        'CHAT_MESSAGE',
        `Новое сообщение в чате праздника для ${room.subjectName}`,
        preview,
        { roomId: room.id, count: 1, lastMessageId: message.id },
        dedupeKey,
      );
      return;
    }

    // Already-read notifications start a new count; unread ones accumulate.
    const prevCount = existing.read || typeof existing.data.count !== 'number' ? 0 : existing.data.count;
    const count = prevCount + 1;
    const title =
      count === 1
        ? `Новое сообщение в чате праздника для ${room.subjectName}`
        : `${count} новых сообщений в чате праздника для ${room.subjectName}`;
    const body = count === 1 ? preview : `Последнее — ${preview}`;
    const data = { roomId: room.id, count, lastMessageId: message.id };

    this.repo.refreshNotification(existing.id, title, body, data);
    this.onNotify(userId, {
      ...existing,
      title,
      body,
      data,
      read: false,
      createdAt: new Date().toISOString(),
    });
  }

  /** Run one scheduler tick. Returns counts for observability/testing. */
  runTick(now: Date = new Date()): { reminders: number; pools: number } {
    let reminders = 0;
    let pools = 0;

    // 1. Reminders at each configured offset.
    for (const offset of this.config.reminderOffsets) {
      const subjects = this.repo.usersWithBirthdayInDays(offset);
      for (const subject of subjects) {
        const cycle = nextBirthdayYear(subject.birthdate, now);
        const subscribers = this.repo.subscriberIdsForSubject(subject.id);
        for (const subscriberId of subscribers) {
          const dedupeKey = `reminder:${subject.id}:${cycle}:${offset}`;
          const created = this.push(
            subscriberId,
            'REMINDER',
            `День рождения ${subject.fullName} через ${offset} ${pluralDays(offset)}`,
            `Не забудьте — скоро ${subject.fullName} станет на год старше. Пора планировать подарок!`,
            { subjectId: subject.id, daysUntil: offset },
            dedupeKey,
          );
          if (created) reminders += 1;
        }
      }
    }

    // 2. Auto-open crowdfunding pools at the lead window.
    const poolSubjects = this.repo.usersWithBirthdayInDays(this.config.poolLeadDays);
    for (const subject of poolSubjects) {
      const subscribers = this.repo.subscriberIdsForSubject(subject.id);
      if (subscribers.length === 0) continue;
      const cycle = nextBirthdayYear(subject.birthdate, now);
      const roomId = randomUUID();
      const room = this.repo.getOrCreateRoomForSubject(subject.id, roomId);
      const poolId = randomUUID();
      const created = this.repo.createPool({
        id: poolId,
        subjectId: subject.id,
        subjectName: subject.fullName,
        roomId: room.id,
        targetAmount: this.config.poolDefaultTarget,
        currentBalance: 0,
        status: 'OPEN',
        openedAt: new Date().toISOString(),
        cycleKey: `${subject.id}:${cycle}`,
      });
      if (created) {
        pools += 1;
        const pool = this.repo.getPoolByRoom(room.id)!;
        this.onPool(pool);
        for (const subscriberId of subscribers) {
          this.push(
            subscriberId,
            'POOL_OPENED',
            `Открыт сбор на подарок для ${subject.fullName}`,
            `В секретном чате открыт сбор на подарок (цель ${this.config.poolDefaultTarget}).`,
            { subjectId: subject.id, poolId, roomId: room.id },
            `pool:${subject.id}:${cycle}`,
          );
        }
      }
    }

    return { reminders, pools };
  }

  /** Convenience: days until a user's birthday (used by routes). */
  daysUntil(birthdate: string, now?: Date): number {
    return daysUntilBirthday(birthdate, now);
  }
}
