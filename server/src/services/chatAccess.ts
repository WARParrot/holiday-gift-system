import type { Repository } from '../db/repository.js';
import type { ParticipantSource } from '../types/domain.js';

/**
 * Central access-control decision for the Secret Coordination Chat.
 *
 * THE core security invariant of the whole product:
 *   The birthday person (a room's `subjectId`) must NEVER be able to read,
 *   join, fetch metadata about, or post into the chat room tied to their own
 *   Friend Card.
 *
 * Access is a POSITIVE authorization model, not a negative one. Being "not the
 * subject" is necessary but NOT sufficient — a user must additionally hold an
 * explicit `chat_participants` grant for the room (see repository). "Who is
 * allowed" is therefore an allowlist we can enumerate, never "everyone on the
 * platform who isn't the birthday person".
 *
 * Two-stage model:
 *   1. ELIGIBILITY  — may this user *join* the room? True when they subscribe to
 *      the subject (directly as a FRIEND or via a shared GROUP) and are not the
 *      subject. Eligibility is the gate for the explicit `join` action.
 *   2. ACCESS       — may this user read/post *now*? True only once they hold a
 *      participant grant (and are still not the subject).
 *
 * Every entry point — REST chat endpoints AND the WebSocket hub — funnels
 * through these functions so the rule cannot drift between transports.
 */
export type AccessReason =
  | 'IS_SUBJECT'
  | 'ROOM_NOT_FOUND'
  | 'SUBJECT_NOT_FOUND'
  | 'NOT_A_PARTICIPANT'
  | 'NOT_ELIGIBLE';

export interface ChatAccessDecision {
  allowed: boolean;
  reason?: AccessReason;
}

/** Result of an eligibility check, carrying how the user qualifies. */
export interface EligibilityDecision {
  eligible: boolean;
  reason?: AccessReason;
  /** How the user qualifies to join (recorded on the participant row). */
  source?: ParticipantSource;
}

/**
 * The hard invariant, kept as a pure function so it is trivially testable and
 * reused everywhere: the subject is denied their own chat unconditionally.
 */
export function isSubject(subjectId: string, requesterId: string): boolean {
  return subjectId === requesterId;
}

/**
 * May `requesterId` JOIN the celebration chat for `subjectId`? They must not be
 * the subject and must have a subscription relationship to them (FRIEND or via
 * a shared GROUP). This is the positive gate for materialising a participant.
 */
export function checkEligibility(
  repo: Repository,
  subjectId: string,
  requesterId: string,
): EligibilityDecision {
  if (isSubject(subjectId, requesterId)) {
    return { eligible: false, reason: 'IS_SUBJECT' };
  }
  const source = repo.subscriptionSourceFor(requesterId, subjectId);
  if (!source) {
    return { eligible: false, reason: 'NOT_ELIGIBLE' };
  }
  return { eligible: true, source };
}

/**
 * May `requesterId` READ/POST in `roomId` right now? Positive check: the room
 * must exist, the requester must not be the subject, and they must hold an
 * explicit participant grant. Missing grant → NOT_A_PARTICIPANT (403), not a
 * silent allow.
 */
export function canAccessRoom(repo: Repository, roomId: string, requesterId: string): ChatAccessDecision {
  const room = repo.getRoomById(roomId);
  if (!room) return { allowed: false, reason: 'ROOM_NOT_FOUND' };
  if (isSubject(room.subjectId, requesterId)) {
    return { allowed: false, reason: 'IS_SUBJECT' };
  }
  if (!repo.isParticipant(roomId, requesterId)) {
    return { allowed: false, reason: 'NOT_A_PARTICIPANT' };
  }
  return { allowed: true };
}
