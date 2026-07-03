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
