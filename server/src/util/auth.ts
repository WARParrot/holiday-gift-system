import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AuthPrincipal, Role } from '../types/domain.js';

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(
  principal: AuthPrincipal,
  secret: string,
  ttlSeconds: number,
): string {
  return jwt.sign(principal, secret, { expiresIn: ttlSeconds });
}

/** Verify + decode a JWT. Returns null on any failure (expired/tampered). */
export function verifyToken(token: string, secret: string): AuthPrincipal | null {
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload & AuthPrincipal;
    if (typeof decoded.userId !== 'string' || typeof decoded.role !== 'string') {
      return null;
    }
    return { userId: decoded.userId, role: decoded.role as Role };
  } catch {
    return null;
  }
}
