/**
 * Domain types shared across the backend.
 * These interfaces mirror the REST API request/response payloads and the
 * database rows. The frontend keeps a structurally-identical copy in
 * `web/src/types/domain.ts` so both sides stay type-safe against the wire.
 */

export type Role = 'USER' | 'ADMIN';

/** A stored user row (never send `passwordHash` over the wire). */
export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  /** ISO date `YYYY-MM-DD`. */
  birthdate: string;
  avatarUrl: string | null;
  role: Role;
  createdAt: string;
}

/** Public user shape returned by the API. */
export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  birthdate: string;
  avatarUrl: string | null;
  role: Role;
  createdAt: string;
}

/** The authenticated principal decoded from a JWT. */
export interface AuthPrincipal {
  userId: string;
  role: Role;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  visibility: 'PUBLIC' | 'INVITE';
  ownerId: string;
  createdAt: string;
}

export interface GroupWithMeta extends Group {
  memberCount: number;
  isMember: boolean;
}

export interface GroupMemberView {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  birthdate: string;
  /** Days until the member's next birthday (0 = today). */
  daysUntilBirthday: number;
}

export type WishlistStatus = 'OPEN' | 'SUGGESTED' | 'RESERVED';

export interface WishlistItem {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  link: string | null;
  priceMin: number | null;
  priceMax: number | null;
  status: WishlistStatus;
  createdAt: string;
}

export type SubscriptionKind = 'FRIEND' | 'GROUP';

export interface Subscription {
  id: string;
  subscriberId: string;
  kind: SubscriptionKind;
  /** Target user id (FRIEND) or group id (GROUP). */
  targetId: string;
  /** Sync a recurring event to an external calendar when true. */
  calendarSync: boolean;
  createdAt: string;
}

export type NotificationType =
  | 'REMINDER'
  | 'POOL_OPENED'
  | 'CHAT_MESSAGE'
  | 'SYSTEM';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Arbitrary JSON metadata (e.g. `{ friendId, daysUntil }`). */
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

/**
 * A secret coordination chat. Exactly one per "celebrated" user
 * (`subjectId`). The subject is *excluded* from all access.
 */
export interface ChatRoom {
  id: string;
  /** The birthday person this room is about — MUST never see it. */
  subjectId: string;
  subjectName: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface CrowdfundingPool {
  id: string;
  subjectId: string;
  subjectName: string;
  roomId: string;
  targetAmount: number;
  currentBalance: number;
  status: 'OPEN' | 'CLOSED';
  /** ISO datetime when the pool auto-opened. */
  openedAt: string;
}

export interface PoolContribution {
  id: string;
  poolId: string;
  contributorId: string;
  contributorName: string;
  amount: number;
  /** Mock-bank transaction reference. */
  txRef: string;
  createdAt: string;
}

/** Standard error envelope returned by the API on non-2xx responses. */
export interface ApiError {
  error: string;
  details?: unknown;
}

/** WebSocket protocol frames (server <-> client). */
export type WsClientFrame =
  | { type: 'auth'; token: string }
  | { type: 'join'; roomId: string }
  | { type: 'message'; roomId: string; body: string };

export type WsServerFrame =
  | { type: 'ready'; userId: string }
  | { type: 'joined'; roomId: string; messages: ChatMessage[] }
  | { type: 'message'; message: ChatMessage }
  | { type: 'pool'; pool: CrowdfundingPool }
  | { type: 'notification'; notification: Notification }
  | { type: 'notification-removed'; id: string }
  | { type: 'error'; error: string };
