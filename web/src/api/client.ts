import type {
  AppNotification,
  CalendarConnection,
  CalendarProviderName,
  CelebrationParticipant,
  ChatMessage,
  CrowdfundingPool,
  DirectoryUser,
  FriendCard,
  Group,
  GroupInvitation,
  GroupMemberView,
  GroupWithMembers,
  GroupWithMeta,
  PoolContribution,
  PublicUser,
  Subscription,
  SubscriptionKind,
  WalletTransaction,
  WishlistItem,
  WishlistStatus,
} from '../types/domain';

const TOKEN_KEY = 'bcms.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  // auth
  register: (body: { email: string; password: string; fullName: string; birthdate: string }) =>
    request<{ token: string; user: PublicUser }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: PublicUser }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  // profile
  me: () => request<{ user: PublicUser }>('/users/me'),
  updateMe: (body: { fullName: string; birthdate: string; avatarUrl?: string | null }) =>
    request<{ user: PublicUser }>('/users/me', { method: 'PUT', body: JSON.stringify(body) }),

  // directory + friend cards
  directory: () => request<{ users: DirectoryUser[] }>('/users'),
  friendCard: (userId: string) => request<FriendCard>(`/users/${userId}/card`),

  // friends
  friends: () => request<{ friends: PublicUser[]; incoming: PublicUser[]; outgoing: PublicUser[] }>('/friends'),
  sendFriendRequest: (userId: string) => request<{ result: string; state: string }>(`/friends/request/${userId}`, { method: 'POST' }),
  acceptFriend: (userId: string) => request<{ ok: true; state: string }>(`/friends/accept/${userId}`, { method: 'POST' }),
  removeFriend: (userId: string) => request<{ ok: true }>(`/friends/${userId}`, { method: 'DELETE' }),

  // groups
  groups: () => request<{ groups: GroupWithMeta[] }>('/groups'),
  createGroup: (body: { name: string; description: string; visibility: 'PUBLIC' | 'INVITE' }) =>
    request<{ group: Group }>('/groups', { method: 'POST', body: JSON.stringify(body) }),
  group: (id: string) =>
    request<{ group: Group; members: GroupMemberView[]; isMember: boolean; pendingInvitations: GroupInvitation[] }>(`/groups/${id}`),
  joinGroup: (id: string) => request<{ ok: true }>(`/groups/${id}/join`, { method: 'POST' }),
  leaveGroup: (id: string) =>
    request<{ ok: true; groupDeleted?: boolean; ownerTransferredTo?: string }>(`/groups/${id}/leave`, { method: 'POST' }),
  inviteToGroup: (groupId: string, userId: string) =>
    request<{ invitation: GroupInvitation; pendingInvitations: GroupInvitation[] }>(`/groups/${groupId}/invite`, { method: 'POST', body: JSON.stringify({ userId }) }),
  groupInvitations: () => request<{ invitations: GroupInvitation[] }>('/groups/invitations'),
  acceptGroupInvitation: (invitationId: string) =>
    request<{ invitation: GroupInvitation; group: Group; members: GroupMemberView[] }>(`/groups/invitations/${invitationId}/accept`, { method: 'POST' }),
  declineGroupInvitation: (invitationId: string) =>
    request<{ ok: true }>(`/groups/invitations/${invitationId}/decline`, { method: 'POST' }),

  // wishlist
  wishlist: (userId: string) => request<{ items: WishlistItem[] }>(`/wishlist/${userId}`),
  addWishlistItem: (body: { title: string; description: string; link?: string | null; priceMin?: number | null; priceMax?: number | null }) =>
    request<{ item: WishlistItem }>('/wishlist', { method: 'POST', body: JSON.stringify(body) }),
  updateWishlistItem: (id: string, body: { title: string; description: string; link?: string | null; priceMin?: number | null; priceMax?: number | null; status?: WishlistStatus }) =>
    request<{ item: WishlistItem }>(`/wishlist/item/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteWishlistItem: (id: string) => request<{ ok: true }>(`/wishlist/item/${id}`, { method: 'DELETE' }),
  setWishlistStatus: (id: string, status: WishlistStatus) =>
    request<{ item: WishlistItem }>(`/wishlist/item/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  // subscriptions
  subscriptions: () => request<{ subscriptions: Subscription[] }>('/subscriptions'),
  subscribe: (body: { kind: SubscriptionKind; targetId: string; calendarSync: boolean }) =>
    request<{ subscription: Subscription }>('/subscriptions', { method: 'POST', body: JSON.stringify(body) }),
  unsubscribe: (body: { kind: SubscriptionKind; targetId: string }) =>
    request<{ ok: true }>('/subscriptions', { method: 'DELETE', body: JSON.stringify({ ...body, calendarSync: false }) }),

  // notifications
  notifications: () => request<{ notifications: AppNotification[]; unread: number }>('/notifications'),
  markNotificationRead: (id: string) => request<{ ok: true }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ ok: true }>('/notifications/read-all', { method: 'POST' }),

  // chat + crowdfunding
  joinSubjectRoom: (subjectId: string) =>
    request<{ room: ChatRoomLite; pool: CrowdfundingPool | null; participants: CelebrationParticipant[] }>(
      `/chat/subject/${subjectId}/room/join`,
      { method: 'POST' },
    ),
  roomMessages: (roomId: string, opts: { limit?: number; before?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', String(opts.limit));
    if (opts.before) qs.set('before', opts.before);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ messages: ChatMessage[]; nextBefore: string | null }>(`/chat/rooms/${roomId}/messages${suffix}`);
  },
  sendMessage: (roomId: string, body: string) =>
    request<{ message: ChatMessage }>(`/chat/rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  editMessage: (roomId: string, messageId: string, body: string) =>
    request<{ message: ChatMessage }>(`/chat/rooms/${roomId}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteMessage: (roomId: string, messageId: string) =>
    request<{ ok: true }>(`/chat/rooms/${roomId}/messages/${messageId}`, { method: 'DELETE' }),
  roomPool: (roomId: string) =>
    request<{ pool: CrowdfundingPool | null; contributions: PoolContribution[] }>(`/chat/rooms/${roomId}/pool`),
  contribute: (roomId: string, amount: number) =>
    request<{ pool: CrowdfundingPool; txRef: string; balance: number }>(`/chat/rooms/${roomId}/pool/contribute`, { method: 'POST', body: JSON.stringify({ amount }) }),

  // admin
  adminRunScheduler: () => request<{ reminders: number; pools: number }>('/admin/run-scheduler', { method: 'POST' }),
  adminUsers: () => request<{ users: PublicUser[] }>('/admin/users'),
  adminDeleteUser: (id: string) => request<{ ok: true }>(`/admin/users/${id}`, { method: 'DELETE' }),
  adminExport: (format: 'json' | 'csv') => request<unknown>(`/admin/export?format=${format}`),
  adminImport: (format: 'json' | 'csv', payload: string) =>
    request<{ created: number; skipped: number; total: number }>('/admin/import', { method: 'POST', body: JSON.stringify({ format, payload }) }),

  // payments / wallet
  wallet: () => request<{ balance: number; transactions: WalletTransaction[] }>('/payments/wallet'),
  topUp: (amount: number, method: string) =>
    request<{ balance: number; transaction: WalletTransaction }>('/payments/topup', { method: 'POST', body: JSON.stringify({ amount, method }) }),

  // calendar connections
  calendarConnections: () =>
    request<{ connections: Array<CalendarConnection & { live: boolean }> }>('/calendar/connections'),
  // Begin the connect flow. The mode tells the SPA what to do next:
  //  - 'oauth' (Google): redirect the top window to authorizeUrl (consent screen);
  //  - 'caldav' (Yandex): collect login + app password and POST them (see below),
  //    because Yandex Calendar uses CalDAV Basic auth, not OAuth;
  //  - 'demo' (provider not configured live): already connected server-side.
  startCalendarConnect: (provider: CalendarProviderName) =>
    request<
      | { mode: 'oauth'; authorizeUrl: string }
      | { mode: 'caldav' }
      | { mode: 'demo'; connected: true; eventsSynced: number }
    >(`/calendar/oauth/${provider}/start`),
  // Connect Yandex with a login + app-specific password (CalDAV Basic auth).
  // The server verifies the credential against Yandex before storing it.
  connectYandexCalDav: (login: string, appPassword: string) =>
    request<{ mode: 'caldav'; connected: true; eventsSynced: number }>(
      '/calendar/connections/yandex/caldav',
      { method: 'POST', body: JSON.stringify({ login, appPassword }) },
    ),
  disconnectCalendar: (provider: CalendarProviderName) =>
    request<{ ok: true }>(`/calendar/connections/${provider}`, { method: 'DELETE' }),

  // admin — money
  adminUserWallet: (id: string) =>
    request<{ balance: number; transactions: WalletTransaction[] }>(`/admin/users/${id}/wallet`),
  adminSetBalance: (id: string, amount: number, mode: 'adjust' | 'set', memo: string) =>
    request<{ user: PublicUser; transaction: WalletTransaction }>(`/admin/users/${id}/balance`, { method: 'PATCH', body: JSON.stringify({ amount, mode, memo }) }),
  adminPools: () =>
    request<{ pools: Array<CrowdfundingPool & { contributions: number }> }>('/admin/pools'),
  adminUpdatePool: (id: string, targetAmount: number, currentBalance: number, status: 'OPEN' | 'CLOSED') =>
    request<{ pool: CrowdfundingPool }>(`/admin/pools/${id}`, { method: 'PUT', body: JSON.stringify({ targetAmount, currentBalance, status }) }),

  // admin — full group management
  adminGroups: () => request<{ groups: GroupWithMembers[] }>('/admin/groups'),
  adminCreateGroup: (body: { name: string; description: string; visibility: 'PUBLIC' | 'INVITE'; ownerId?: string }) =>
    request<{ group: Group }>('/admin/groups', { method: 'POST', body: JSON.stringify(body) }),
  adminUpdateGroup: (id: string, body: { name: string; description: string; visibility: 'PUBLIC' | 'INVITE'; ownerId?: string }) =>
    request<{ group: Group; members: GroupMemberView[] }>(`/admin/groups/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  adminDeleteGroup: (id: string) => request<{ ok: true }>(`/admin/groups/${id}`, { method: 'DELETE' }),
  adminAddGroupMember: (groupId: string, userId: string) =>
    request<{ members: GroupMemberView[] }>(`/admin/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),
  adminRemoveGroupMember: (groupId: string, userId: string) =>
    request<{ members: GroupMemberView[] }>(`/admin/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),

  // admin — chat moderation
  adminRooms: () => request<{ rooms: Array<ChatRoomLite & { messageCount: number; participantCount: number }> }>('/admin/rooms'),
  adminRoomMessages: (roomId: string) => request<{ messages: ChatMessage[] }>(`/admin/rooms/${roomId}/messages`),
  adminCreateMessage: (roomId: string, body: string) =>
    request<{ message: ChatMessage }>(`/admin/rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  adminEditMessage: (messageId: string, body: string) =>
    request<{ message: ChatMessage }>(`/admin/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  adminDeleteMessage: (messageId: string) => request<{ ok: true }>(`/admin/messages/${messageId}`, { method: 'DELETE' }),
};

export interface ChatRoomLite {
  id: string;
  subjectId: string;
  subjectName: string;
  createdAt: string;
}

export { ApiError };
