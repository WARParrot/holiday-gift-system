import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { groupSchema } from './schemas.js';

/**
 * Group creation, the master directory, membership, and member listings.
 */
export function groupRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config, repo));

  // GET /api/groups — master directory of all groups (scenario 1)
  router.get('/', (req, res) => {
    res.json({ groups: repo.listGroups(req.principal!.userId) });
  });

  // POST /api/groups — any user can create a group
  router.post('/', (req, res) => {
    const body = parseBody(groupSchema, req.body, res);
    if (!body) return;
    const group = {
      id: randomUUID(),
      name: body.name,
      description: body.description ?? '',
      visibility: body.visibility,
      ownerId: req.principal!.userId,
      createdAt: new Date().toISOString(),
    };
    repo.createGroup(group);
    repo.addMember(group.id, req.principal!.userId);
    res.status(201).json({ group });
  });

  // GET /api/groups/:id — group detail with members + upcoming birthdays
  router.get('/:id', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    res.json({
      group,
      members: repo.listGroupMembers(group.id),
      isMember: repo.isMember(group.id, req.principal!.userId),
    });
  });

  // POST /api/groups/:id/join
  router.post('/:id/join', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (group.visibility === 'INVITE' && group.ownerId !== req.principal!.userId) {
      // For invite-only groups, membership is only auto-granted to the owner here.
      // A fuller implementation would check an invitation token.
      res.status(403).json({ error: 'This group is invite-only' });
      return;
    }
    repo.addMember(group.id, req.principal!.userId);
    res.json({ ok: true });
  });

  // POST /api/groups/:id/leave
  router.post('/:id/leave', (req, res) => {
    repo.removeMember(req.params.id, req.principal!.userId);
    res.json({ ok: true });
  });

  return router;
}
