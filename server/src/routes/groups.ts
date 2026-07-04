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

  router.get('/invitations', (req, res) => {
    res.json({ invitations: repo.listPendingGroupInvitationsForUser(req.principal!.userId) });
  });

  router.post('/invitations/:invitationId/accept', (req, res) => {
    const invitation = repo.acceptGroupInvitation(req.params.invitationId, req.principal!.userId);
    if (!invitation) return res.status(404).json({ error: 'Приглашение не найдено' });
    return res.json({ invitation, group: repo.getGroup(invitation.groupId), members: repo.listGroupMembers(invitation.groupId) });
  });

  router.post('/invitations/:invitationId/decline', (req, res) => {
    const declined = repo.declineGroupInvitation(req.params.invitationId, req.principal!.userId);
    if (!declined) return res.status(404).json({ error: 'Приглашение не найдено' });
    return res.json({ ok: true });
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
    if (!group) return res.status(404).json({ error: 'Группа не найдена' });
    const isOwner = group.ownerId === req.principal!.userId;
    res.json({
      group,
      members: repo.listGroupMembers(group.id),
      isMember: repo.isMember(group.id, req.principal!.userId),
      pendingInvitations: isOwner ? repo.listPendingGroupInvitationsByGroup(group.id) : [],
    });
  });

  router.post('/:id/join', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Группа не найдена' });
    if (group.visibility === 'INVITE' && group.ownerId !== req.principal!.userId) {
      return res.status(403).json({ error: 'Эта группа только по приглашению' });
    }
    repo.addMember(group.id, req.principal!.userId);
    return res.json({ ok: true });
  });

  // Owner invite widget backend: creates a pending invitation. The invitee must accept before membership changes.
  router.post('/:id/invite', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Группа не найдена' });
    if (group.ownerId !== req.principal!.userId) return res.status(403).json({ error: 'Приглашать участников может только владелец группы' });
    const body = parseBody(inviteSchema, req.body, res);
    if (!body) return;
    if (!repo.findUserById(body.userId)) return res.status(404).json({ error: 'Пользователь не найден' });
    if (repo.isMember(group.id, body.userId)) return res.status(409).json({ error: 'Пользователь уже участник группы' });
    const invitation = repo.createGroupInvitation(group.id, req.principal!.userId, body.userId);
    return res.status(201).json({ invitation, pendingInvitations: repo.listPendingGroupInvitationsByGroup(group.id) });
  });

  router.post('/:id/leave', (req, res) => {
    const group = repo.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Группа не найдена' });
    const leaver = req.principal!.userId;
    if (!repo.isMember(group.id, leaver)) return res.status(404).json({ error: 'Вы не состоите в этой группе' });

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
