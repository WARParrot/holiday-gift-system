import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthdate must be YYYY-MM-DD');

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
  birthdate: isoDate,
  avatarUrl: z.string().url().nullable().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const profileSchema = z.object({
  fullName: z.string().min(1),
  birthdate: isoDate,
  avatarUrl: z.string().url().nullable().optional(),
});

export const groupSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  visibility: z.enum(['PUBLIC', 'INVITE']).default('PUBLIC'),
});

export const wishlistCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  link: z.string().url().nullable().optional(),
  priceMin: z.number().nonnegative().nullable().optional(),
  priceMax: z.number().nonnegative().nullable().optional(),
});

export const wishlistUpdateSchema = wishlistCreateSchema.extend({
  status: z.enum(['OPEN', 'SUGGESTED', 'RESERVED']).optional(),
});

export const wishlistStatusSchema = z.object({
  status: z.enum(['OPEN', 'SUGGESTED', 'RESERVED']),
});

export const subscribeSchema = z.object({
  kind: z.enum(['FRIEND', 'GROUP']),
  targetId: z.string().min(1),
  calendarSync: z.boolean().default(false),
});

export const contributeSchema = z.object({
  amount: z.number().positive(),
});

export const topUpSchema = z.object({
  amount: z.number().positive().max(100000),
  /** Non-sensitive display label only, e.g. "Visa •• 4242". Never a real PAN. */
  method: z.string().min(1).max(60).default('Mock card'),
});

export const calendarConnectSchema = z.object({
  provider: z.enum(['google', 'yandex']),
  accountLabel: z.string().min(1).max(120),
});

export const adminGroupUpsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  visibility: z.enum(['PUBLIC', 'INVITE']).default('PUBLIC'),
  ownerId: z.string().min(1).optional(),
});

export const adminGroupMemberSchema = z.object({
  userId: z.string().min(1),
});

export const adminBalanceSchema = z.object({
  /** Signed delta to apply, or set an absolute value when `mode` is 'set'. */
  amount: z.number(),
  mode: z.enum(['adjust', 'set']).default('adjust'),
  memo: z.string().max(200).default(''),
});

export const adminPoolFinanceSchema = z.object({
  targetAmount: z.number().nonnegative(),
  currentBalance: z.number().nonnegative(),
  status: z.enum(['OPEN', 'CLOSED']),
});

export const adminUserUpsertSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  birthdate: isoDate,
  role: z.enum(['USER', 'ADMIN']).default('USER'),
  password: z.string().min(6).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const adminImportSchema = z.object({
  format: z.enum(['json', 'csv']),
  /** Raw payload: a JSON array (as string) or CSV text. */
  payload: z.string().min(1),
});

/**
 * Yandex Calendar connect credentials. Yandex CalDAV uses HTTP Basic auth with
 * the account login + an app-specific password (NOT an OAuth token), so the
 * user supplies both directly. `login` is the full Yandex login/email; the app
 * password is a 16-ish char token generated in Yandex ID → App passwords.
 */
export const yandexCalDavConnectSchema = z.object({
  login: z.string().min(1).max(190),
  appPassword: z.string().min(1).max(190),
});
