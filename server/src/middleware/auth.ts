import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { AuthPrincipal } from '../types/domain.js';
import { verifyToken } from '../util/auth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: AuthPrincipal;
    }
  }
}

/**
 * Require a valid Bearer token; attaches `req.principal`.
 *
 * The token is verified cryptographically AND the principal is re-validated
 * against the database on every request:
 *   - a token for a user who no longer exists (e.g. the account was deleted)
 *     is rejected with 401, instead of remaining valid until the 7-day expiry;
 *   - the role is re-read from the DB rather than trusted from the token, so a
 *     role change (grant/revoke admin) takes effect immediately instead of
 *     being frozen into the long-lived token.
 */
export function requireAuth(config: AppConfig, repo: Repository) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const principal = token ? verifyToken(token, config.jwtSecret) : null;
    if (!principal) {
      res.status(401).json({ error: 'Требуется авторизация' });
      return;
    }
    // Re-validate against the live DB — the token alone is not authoritative.
    const user = repo.findUserById(principal.userId);
    if (!user) {
      res.status(401).json({ error: 'Аккаунт больше не существует' });
      return;
    }
    // Trust the DB role, not the (possibly stale) token claim.
    req.principal = { userId: user.id, role: user.role };
    next();
  };
}

/** Require the ADMIN role (must be used after requireAuth). */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.principal?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Требуется роль администратора' });
    return;
  }
  next();
}
