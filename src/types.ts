/**
 * Core domain types for the Birthday Celebration Management System.
 *
 * These are intentionally minimal (barebones). Extend them as features
 * from the technical specification are implemented (e.g. crowdfunding pools,
 * calendar sync, admin roles).
 */

export type ID = string;

/** ISO date string, e.g. "1998-04-23". */
export type ISODate = string;

/** ISO datetime string, e.g. "2026-07-03T12:00:00.000Z". */
export type ISODateTime = string;

export interface WishlistItem {
  id: ID;
  title: string;
  description?: string;
  link?: string;
  /** Free-form price range, e.g. "$20 - $40". */
  priceRange?: string;
  /** Coordination status shown when viewing someone else's wishlist. */
  status: 'available' | 'suggested' | 'reserved';
}

export interface User {
  id: ID;
  fullName: string;
  /** Emoji or URL placeholder used as an avatar in this barebones version. */
  avatar: string;
  birthDate: ISODate;
  groupIds: ID[];
  wishlist: WishlistItem[];
}

export interface Group {
  id: ID;
  name: string;
  description: string;
  visibility: 'public' | 'invite';
  memberIds: ID[];
}

/** A message in a friend's Secret Celebration Chat. */
export interface ChatMessage {
  id: ID;
  /** The friend card this chat belongs to (the birthday person). */
  friendCardUserId: ID;
  authorId: ID;
  text: string;
  createdAt: ISODateTime;
}

export interface Subscription {
  /** Whether the user subscribed to a single friend or a whole group. */
  type: 'friend' | 'group';
  targetId: ID;
}

export interface AppNotification {
  id: ID;
  message: string;
  createdAt: ISODateTime;
  read: boolean;
}
