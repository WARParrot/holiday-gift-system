import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { adminImportSchema, adminUserUpsertSchema } from './schemas.js';
import { hashPassword } from '../util/auth.js';
import type { UserRow } from '../types/domain.js';

/**
 * Administrative back-office. Restricted to ADMIN role. Provides full CRUD over
 * users/groups/wishlists and batch import/export in JSON or CSV.
 */
export function adminRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config), requireAdmin);

  // --- Users -------------------------------------------------------------
  router.get('/users', (_req, res) => {
    res.json({ users: repo.listUsers() });
  });

  router.post('/users', (req, res) => {
    const body = parseBody(adminUserUpsertSchema, req.body, res);
    if (!body) return;
    if (repo.findUserByEmail(body.email)) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    const id = randomUUID();
    repo.createUser({
      id,
      email: body.email,
      passwordHash: hashPassword(body.password ?? 'password'),
      fullName: body.fullName,
      birthdate: body.birthdate,
      avatarUrl: body.avatarUrl ?? null,
      role: body.role,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ user: repo.toPublic(repo.findUserById(id)!) });
  });

  router.put('/users/:id', (req, res) => {
    const existing = repo.findUserById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const body = parseBody(adminUserUpsertSchema, req.body, res);
    if (!body) return;
    repo.updateUserProfile(existing.id, body.fullName, body.birthdate, body.avatarUrl ?? null);
    repo.setUserRole(existing.id, body.role);
    res.json({ user: repo.toPublic(repo.findUserById(existing.id)!) });
  });

  router.delete('/users/:id', (req, res) => {
    if (!repo.findUserById(req.params.id)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    repo.deleteUser(req.params.id);
    res.json({ ok: true });
  });

  // --- Groups ------------------------------------------------------------
  router.get('/groups', (req, res) => {
    res.json({ groups: repo.listGroups(req.principal!.userId) });
  });

  router.delete('/groups/:id', (req, res) => {
    repo.deleteGroup(req.params.id);
    res.json({ ok: true });
  });

  // --- Wishlists ---------------------------------------------------------
  router.get('/wishlists/:userId', (req, res) => {
    res.json({ items: repo.listWishlist(req.params.userId) });
  });

  router.delete('/wishlists/item/:id', (req, res) => {
    repo.deleteWishlistItem(req.params.id);
    res.json({ ok: true });
  });

  // --- Data portability --------------------------------------------------
  // GET /api/admin/export?format=json|csv — export all users
  router.get('/export', (req, res) => {
    const format = (req.query.format as string) || 'json';
    const users = repo.listUsers();
    if (format === 'csv') {
      const header = 'id,email,fullName,birthdate,role';
      const rows = users.map(
        (u) => `${u.id},${csvEscape(u.email)},${csvEscape(u.fullName)},${u.birthdate},${u.role}`,
      );
      res.type('text/csv').send([header, ...rows].join('\n'));
      return;
    }
    res.json({ users });
  });

  // POST /api/admin/import — batch ingest users from JSON array or CSV
  router.post('/import', (req, res) => {
    const body = parseBody(adminImportSchema, req.body, res);
    if (!body) return;
    let records: Array<Partial<UserRow> & { password?: string }> = [];
    try {
      records = body.format === 'json' ? parseJsonUsers(body.payload) : parseCsvUsers(body.payload);
    } catch (err) {
      res.status(400).json({ error: `Failed to parse ${body.format}`, details: String(err) });
      return;
    }

    let created = 0;
    let skipped = 0;
    for (const rec of records) {
      if (!rec.email || !rec.fullName || !rec.birthdate) {
        skipped += 1;
        continue;
      }
      if (repo.findUserByEmail(rec.email)) {
        skipped += 1;
        continue;
      }
      repo.createUser({
        id: randomUUID(),
        email: rec.email,
        passwordHash: hashPassword(rec.password ?? 'password'),
        fullName: rec.fullName,
        birthdate: rec.birthdate,
        avatarUrl: rec.avatarUrl ?? null,
        role: rec.role === 'ADMIN' ? 'ADMIN' : 'USER',
        createdAt: new Date().toISOString(),
      });
      created += 1;
    }
    res.json({ created, skipped, total: records.length });
  });

  return router;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function parseJsonUsers(payload: string): Array<Partial<UserRow> & { password?: string }> {
  const parsed = JSON.parse(payload);
  if (!Array.isArray(parsed)) throw new Error('JSON payload must be an array');
  return parsed as Array<Partial<UserRow> & { password?: string }>;
}

/** Minimal CSV parser supporting quoted fields with embedded commas/quotes. */
function parseCsvUsers(payload: string): Array<Partial<UserRow> & { password?: string }> {
  const lines = payload.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h.trim()] = (cells[i] ?? '').trim();
    });
    return {
      email: rec.email,
      fullName: rec.fullName || rec.full_name,
      birthdate: rec.birthdate,
      role: (rec.role as UserRow['role']) || 'USER',
      password: rec.password,
    };
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
