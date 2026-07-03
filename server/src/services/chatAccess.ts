import type { Repository } from '../db/repository.js';

/**
 * Central access-control decision for the Secret Coordination Chat.
 *
 * THE core security invariant of the whole product:
 *   The birthday person (a room's `subjectId`) must NEVER be able to read,
 *   join, fetch metadata about, or post into the chat room tied to their own
 *   Friend Card.
 *
 * Every entry point — REST chat endpoints AND the WebSocket hub — funnels
 * through `canAccessRoom` / `canAccessSubjectChat`. There is deliberately one
 * function so the rule cannot drift between transports.
 */
export interface ChatAccessDecision {
  allowed: boolean;
  reason?: 'IS_SUBJECT' | 'ROOM_NOT_FOUND' | 'SUBJECT_NOT_FOUND';
}

export function canAccessSubjectChat(subjectId: string, requesterId: string): ChatAccessDecision {
  if (subjectId === requesterId) {
    return { allowed: false, reason: 'IS_SUBJECT' };
  }
  return { allowed: true };
}

export function canAccessRoom(repo: Repository, roomId: string, requesterId: string): ChatAccessDecision {
  const room = repo.getRoomById(roomId);
  if (!room) return { allowed: false, reason: 'ROOM_NOT_FOUND' };
  return canAccessSubjectChat(room.subjectId, requesterId);
}
