/**
 * Frontend copy of the API domain contracts. Kept structurally identical to
 * `server/src/types/domain.ts` so the client is type-safe against the wire.
 */
export type Role = 'USER' | 'ADMIN';

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  birthdate: string;
  avatarUrl: string | null;
  role: Role;
  createdAt: string;
}

export interface DirectoryUser extends PublicUser {
  daysUntilBirthday: number;
  isSelf: boolean;
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
  targetId: string;
  calendarSync: boolean;
  createdAt: string;
}

export type NotificationType = 'REMINDER' | 'POOL_OPENED' | 'CHAT_MESSAGE' | 'SYSTEM';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface ChatRoom {
  id: string;
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
  openedAt: string;
}

export interface PoolContribution {
  id: string;
  poolId: string;
  contributorId: string;
  contributorName: string;
  amount: number;
  txRef: string;
  createdAt: string;
}

export interface FriendCard {
  user: PublicUser;
  daysUntilBirthday: number;
  groups: Group[];
  wishlist: WishlistItem[];
  secretChat: { roomId: string; visible: true } | { visible: false };
  isSelf: boolean;
}

export type WsServerFrame =
  | { type: 'ready'; userId: string }
  | { type: 'joined'; roomId: string; messages: ChatMessage[] }
  | { type: 'message'; message: ChatMessage }
  | { type: 'pool'; pool: CrowdfundingPool }
  | { type: 'notification'; notification: AppNotification }
  | { type: 'notification-removed'; id: string }
  | { type: 'error'; error: string };
