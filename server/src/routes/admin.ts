import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import {
  adminBalanceSchema,
  adminGroupMemberSchema,
  adminGroupUpsertSchema,
  adminImportSchema,
  adminPoolFinanceSchema,
  adminUserUpsertSchema,
} from './schemas.js';
import { hashPassword } from '../util/auth.js';
import type { UserRow } from '../types/domain.js';

/**
 * Administrative back-office. Restricted to ADMIN role. Provides full CRUD over
 * users/groups/wishlists and batch import/export in JSON or CSV.
 */
export function adminRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config, repo), requireAdmin);

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
      balance: 0,
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

  // PATCH /api/admin/users/:id/balance — adjust or set a user's wallet balance
  router.patch('/users/:id/balance', (req, res) => {
    const user = repo.findUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const body = parseBody(adminBalanceSchema, req.body, res);
    if (!body) return;

    const delta = body.mode === 'set' ? body.amount - user.balance : body.amount;
    const tx = repo.applyWalletTransaction({
      id: randomUUID(),
      userId: user.id,
      kind: 'ADMIN_ADJUST',
      amount: delta,
      memo: body.memo || `Admin ${body.mode} by ${req.principal!.userId}`,
      txRef: `ADMIN-${Date.now().toString(36).toUpperCase()}`,
      allowNegative: true,
    });
    if (!tx) {
      res.status(400).json({ error: 'Adjustment failed' });
      return;
    }
    res.json({ user: repo.toPublic(repo.findUserById(user.id)!), transaction: tx });
  });

  // GET /api/admin/users/:id/wallet — a user's balance + ledger
  router.get('/users/:id/wallet', (req, res) => {
    if (!repo.findUserById(req.params.id)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      balance: repo.getBalance(req.params.id),
      transactions: repo.listWalletTransactions(req.params.id, 100),
    });
  });

  // --- Crowdfunding pools (money management) -----------------------------
  router.get('/pools', (_req, res) => {
    const pools = repo.listAllPools().map((p) => ({
      ...p,
      contributions: repo.listContributions(p.id).length,
    }));
    res.json({ pools });
  });

  router.put('/pools/:id', (req, res) => {
    const pool = repo.getPoolById(req.params.id);
    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }
    const body = parseBody(adminPoolFinanceSchema, req.body, res);
    if (!body) return;
    const updated = repo.updatePoolFinance(pool.id, {
      targetAmount: body.targetAmount,
      currentBalance: body.currentBalance,
      status: body.status,
    }, req.principal!.userId);
    // Push the change live to anyone watching the room.
    if (updated) ctx.hub.current?.publishPool(updated);
    res.json({ pool: updated });
  });

  // --- Groups (full management) ------------------------------------------
  router.get('/groups', (req, res) => {
    const groups = repo.listGroups(req.principal!.userId).map((g) => ({
      ...g,
      members: repo.listGroupMembers(g.id),
    }));
    res.json({ groups });
  });

  router.post('/groups', (req, res) => {
    const body = parseBody(adminGroupUpsertSchema, req.body, res);
    if (!body) return;
    const ownerId = body.ownerId ?? req.principal!.userId;
    if (!repo.findUserById(ownerId)) {
      res.status(400).json({ error: 'Owner user not found' });
      return;
    }
    const group = {
      id: randomUUID(),
      name: body.name,
      description: body.description ?? '',
      visibility: body.visibility,
      ownerId,
      createdAt: new Date().toISOString(),
    };
    repo.createGroup(group);
    repo.addMember(group.id, ownerId);
    res.status(201).json({ group });
  });

  router.put('/groups/:id', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const body = parseBody(adminGroupUpsertSchema, req.body, res);
    if (!body) return;
    if (body.ownerId && !repo.findUserById(body.ownerId)) {
      res.status(400).json({ error: 'Owner user not found' });
      return;
    }
    repo.updateGroup(group.id, {
      name: body.name,
      description: body.description ?? '',
      visibility: body.visibility,
      ownerId: body.ownerId,
    });
    if (body.ownerId) repo.addMember(group.id, body.ownerId);
    res.json({ group: repo.getGroup(group.id), members: repo.listGroupMembers(group.id) });
  });

  router.delete('/groups/:id', (req, res) => {
    repo.deleteGroup(req.params.id);
    res.json({ ok: true });
  });

  router.post('/groups/:id/members', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const body = parseBody(adminGroupMemberSchema, req.body, res);
    if (!body) return;
    if (!repo.findUserById(body.userId)) {
      res.status(400).json({ error: 'User not found' });
      return;
    }
    repo.addMember(group.id, body.userId);
    res.status(201).json({ members: repo.listGroupMembers(group.id) });
  });

  router.delete('/groups/:id/members/:userId', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    repo.removeMember(group.id, req.params.userId);
    res.json({ members: repo.listGroupMembers(group.id) });
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
        balance: 0,
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
