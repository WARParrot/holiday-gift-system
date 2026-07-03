import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { CrowdfundingPool, Notification } from '../types/domain.js';
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
            `${subject.fullName}'s birthday in ${offset} day${offset === 1 ? '' : 's'}`,
            `Don't forget — ${subject.fullName} turns another year older soon. Time to plan!`,
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
            `Gift pool opened for ${subject.fullName}`,
            `A crowdfunding pool (target ${this.config.poolDefaultTarget}) is now open in the secret chat.`,
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
