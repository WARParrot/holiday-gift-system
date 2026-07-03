import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { hashPassword, signToken, verifyPassword } from '../util/auth.js';
import { parseBody } from '../util/validate.js';
import { loginSchema, registerSchema } from './schemas.js';

export function authRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;

  // POST /api/auth/register
  router.post('/register', (req, res) => {
    const body = parseBody(registerSchema, req.body, res);
    if (!body) return;
    if (repo.findUserByEmail(body.email)) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    const id = randomUUID();
    repo.createUser({
      id,
      email: body.email,
      passwordHash: hashPassword(body.password),
      fullName: body.fullName,
      birthdate: body.birthdate,
      avatarUrl: body.avatarUrl ?? null,
      role: 'USER',
      createdAt: new Date().toISOString(),
    });
    const user = repo.findUserById(id)!;
    const token = signToken({ userId: id, role: user.role }, config.jwtSecret, config.jwtTtl);
    res.status(201).json({ token, user: repo.toPublic(user) });
  });

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    const body = parseBody(loginSchema, req.body, res);
    if (!body) return;
    const user = repo.findUserByEmail(body.email);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    const token = signToken({ userId: user.id, role: user.role }, config.jwtSecret, config.jwtTtl);
    res.json({ token, user: repo.toPublic(user) });
  });

  return router;
}
