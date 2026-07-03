/**
 * In-memory mock data standing in for the Backend API + RDBMS.
 *
 * Replace these with real REST/WebSocket calls when the backend exists.
 * `CURRENT_USER_ID` simulates the authenticated session (JWT subject).
 */

import type { ChatMessage, Group, User } from '../types';

export const CURRENT_USER_ID = 'u1';

export const USERS: User[] = [
  {
    id: 'u1',
    fullName: 'You (Alex)',
    avatar: '🧑‍💻',
    birthDate: '1997-11-02',
    groupIds: ['g1', 'g2'],
    wishlist: [
      {
        id: 'w-u1-1',
        title: 'Mechanical keyboard',
        description: 'Tactile switches, wireless.',
        priceRange: '$80 - $120',
        status: 'available',
      },
    ],
  },
  {
    id: 'u2',
    fullName: 'Maria Petrova',
    avatar: '👩‍🎨',
    birthDate: '1998-07-10',
    groupIds: ['g1'],
    wishlist: [
      {
        id: 'w-u2-1',
        title: 'Watercolor set',
        description: 'Professional grade, 24 colors.',
        link: 'https://example.com/watercolor',
        priceRange: '$40 - $60',
        status: 'suggested',
      },
      {
        id: 'w-u2-2',
        title: 'Art history book',
        priceRange: '$25',
        status: 'available',
      },
    ],
  },
  {
    id: 'u3',
    fullName: 'Ivan Sokolov',
    avatar: '🏐',
    birthDate: '1995-07-05',
    groupIds: ['g2'],
    wishlist: [
      {
        id: 'w-u3-1',
        title: 'Volleyball knee pads',
        priceRange: '$30',
        status: 'available',
      },
    ],
  },
  {
    id: 'u4',
    fullName: 'Elena Volkova',
    avatar: '📚',
    birthDate: '1999-12-21',
    groupIds: ['g1', 'g2'],
    wishlist: [],
  },
];

export const GROUPS: Group[] = [
  {
    id: 'g1',
    name: 'TSEU Group 972501',
    description: 'University study group.',
    visibility: 'public',
    memberIds: ['u1', 'u2', 'u4'],
  },
  {
    id: 'g2',
    name: 'Volleyball Team',
    description: 'Weekend volleyball squad.',
    visibility: 'invite',
    memberIds: ['u1', 'u3', 'u4'],
  },
];

/** Seed messages for the secret celebration chats, keyed by friend card. */
export const CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    friendCardUserId: 'u2',
    authorId: 'u1',
    text: "Let's chip in for the watercolor set!",
    createdAt: '2026-07-01T09:30:00.000Z',
  },
  {
    id: 'm2',
    friendCardUserId: 'u2',
    authorId: 'u4',
    text: 'Great idea. I can also bake a cake.',
    createdAt: '2026-07-01T10:15:00.000Z',
  },
];
