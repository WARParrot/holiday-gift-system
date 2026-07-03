import type {
  AppNotification,
  ChatMessage,
  CrowdfundingPool,
  DirectoryUser,
  FriendCard,
  Group,
  GroupMemberView,
  GroupWithMeta,
  PoolContribution,
  PublicUser,
  Subscription,
  SubscriptionKind,
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

  // groups
  groups: () => request<{ groups: GroupWithMeta[] }>('/groups'),
  createGroup: (body: { name: string; description: string; visibility: 'PUBLIC' | 'INVITE' }) =>
    request<{ group: Group }>('/groups', { method: 'POST', body: JSON.stringify(body) }),
  group: (id: string) =>
    request<{ group: Group; members: GroupMemberView[]; isMember: boolean }>(`/groups/${id}`),
  joinGroup: (id: string) => request<{ ok: true }>(`/groups/${id}/join`, { method: 'POST' }),
  leaveGroup: (id: string) => request<{ ok: true }>(`/groups/${id}/leave`, { method: 'POST' }),

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
  runScheduler: () => request<{ reminders: number; pools: number }>('/notifications/run-scheduler', { method: 'POST' }),

  // chat + crowdfunding
  subjectRoom: (subjectId: string) =>
    request<{ room: ChatRoomLite; pool: CrowdfundingPool | null }>(`/chat/subject/${subjectId}/room`),
  roomMessages: (roomId: string) => request<{ messages: ChatMessage[] }>(`/chat/rooms/${roomId}/messages`),
  sendMessage: (roomId: string, body: string) =>
    request<{ message: ChatMessage }>(`/chat/rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  roomPool: (roomId: string) =>
    request<{ pool: CrowdfundingPool | null; contributions: PoolContribution[] }>(`/chat/rooms/${roomId}/pool`),
  contribute: (roomId: string, amount: number) =>
    request<{ pool: CrowdfundingPool; txRef: string }>(`/chat/rooms/${roomId}/pool/contribute`, { method: 'POST', body: JSON.stringify({ amount }) }),

  // admin
  adminUsers: () => request<{ users: PublicUser[] }>('/admin/users'),
  adminDeleteUser: (id: string) => request<{ ok: true }>(`/admin/users/${id}`, { method: 'DELETE' }),
  adminExport: (format: 'json' | 'csv') => request<unknown>(`/admin/export?format=${format}`),
  adminImport: (format: 'json' | 'csv', payload: string) =>
    request<{ created: number; skipped: number; total: number }>('/admin/import', { method: 'POST', body: JSON.stringify({ format, payload }) }),
};

export interface ChatRoomLite {
  id: string;
  subjectId: string;
  subjectName: string;
  createdAt: string;
}

export { ApiError };
