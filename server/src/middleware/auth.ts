import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config.js';
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

/** Require a valid Bearer token; attaches `req.principal`. */
export function requireAuth(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const principal = token ? verifyToken(token, config.jwtSecret) : null;
    if (!principal) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.principal = principal;
    next();
  };
}

/** Require the ADMIN role (must be used after requireAuth). */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.principal?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  next();
}
