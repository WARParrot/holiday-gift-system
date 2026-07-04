import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { groupSchema, inviteSchema } from './schemas.js';

/**
 * Group creation, the master directory, membership, owner invites, and member listings.
 */
export function groupRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config, repo));

  router.get('/', (req, res) => {
    res.json({ groups: repo.listGroups(req.principal!.userId) });
  });

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

  router.get('/:id', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ group, members: repo.listGroupMembers(group.id), isMember: repo.isMember(group.id, req.principal!.userId) });
  });

  router.post('/:id/join', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.visibility === 'INVITE' && group.ownerId !== req.principal!.userId) {
      return res.status(403).json({ error: 'This group is invite-only' });
    }
    repo.addMember(group.id, req.principal!.userId);
    return res.json({ ok: true });
  });

  // Owner invite widget backend: owner directly grants membership to a user.
  router.post('/:id/invite', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.ownerId !== req.principal!.userId) return res.status(403).json({ error: 'Only the group owner can invite members' });
    const body = parseBody(inviteSchema, req.body, res);
    if (!body) return;
    if (!repo.findUserById(body.userId)) return res.status(404).json({ error: 'User not found' });
    repo.addMember(group.id, body.userId);
    return res.status(201).json({ members: repo.listGroupMembers(group.id) });
  });

  router.post('/:id/leave', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const leaver = req.principal!.userId;
    if (!repo.isMember(group.id, leaver)) return res.status(404).json({ error: 'You are not a member of this group' });

    repo.removeMember(group.id, leaver);
    const remaining = repo.memberIdsOfGroup(group.id);
    if (remaining.length === 0) {
      repo.deleteGroup(group.id);
      return res.json({ ok: true, groupDeleted: true });
    }
    if (group.ownerId === leaver) {
      repo.setGroupOwner(group.id, remaining[0]);
      return res.json({ ok: true, ownerTransferredTo: remaining[0] });
    }
    return res.json({ ok: true });
  });

  return router;
}
