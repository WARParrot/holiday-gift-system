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
  /** Account wallet balance. */
  balance: number;
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
  balance: number;
  createdAt: string;
}

export type WalletTxKind = 'TOPUP' | 'CONTRIBUTION' | 'ADMIN_ADJUST' | 'REFUND';

export interface WalletTransaction {
  id: string;
  userId: string;
  kind: WalletTxKind;
  /** Signed amount: positive credits, negative debits. */
  amount: number;
  balanceAfter: number;
  memo: string;
  txRef: string;
  createdAt: string;
}

export type CalendarProviderName = 'google' | 'yandex';

export interface CalendarConnection {
  userId: string;
  provider: CalendarProviderName;
  accountLabel: string;
  connectedAt: string;
}

/** Stored per-user OAuth2 token for a live external-calendar provider. */
export interface CalendarOAuthToken {
  userId: string;
  provider: CalendarProviderName;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  /** Provider account login/email (used to build the Yandex CalDAV path). */
  accountLogin: string;
  /** Epoch millis when the access token expires (0 = unknown). */
  expiresAt: number;
  updatedAt: string;
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

export type FriendshipStatus = 'PENDING' | 'ACCEPTED';

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  userLow: string;
  userHigh: string;
  status: FriendshipStatus;
  createdAt: string;
  acceptedAt: string | null;
}

export type FriendState = 'none' | 'pending_incoming' | 'pending_outgoing' | 'friends';

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

export type ParticipantRole = 'ORGANIZER' | 'PARTICIPANT';
export type ParticipantSource = 'FRIEND' | 'GROUP';

/**
 * A member of a secret celebration chat. The presence of this row is the
 * positive authorization grant: only users with a `CelebrationParticipant`
 * row (and who are not the subject) may read or post in a room.
 */
export interface CelebrationParticipant {
  roomId: string;
  userId: string;
  role: ParticipantRole;
  source: ParticipantSource;
  joinedAt: string;
}

/** A participant enriched with the user's display fields (for the roster UI). */
export interface CelebrationParticipantView extends CelebrationParticipant {
  fullName: string;
  avatarUrl: string | null;
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
  | { type: 'message-updated'; message: ChatMessage }
  | { type: 'message-deleted'; id: string; roomId: string }
  | { type: 'pool'; pool: CrowdfundingPool }
  | { type: 'notification'; notification: Notification }
  | { type: 'notification-removed'; id: string }
  | { type: 'error'; error: string };
