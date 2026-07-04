import { Router } from 'express';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';

/** Mutual friendship: request → accept. Friendship is required before a user can
 * subscribe directly to another person's reminders and gain FRIEND-source chat eligibility.
 */
export function friendRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config, repo));

  router.get('/', (req, res) => {
    const me = req.principal!.userId;
    res.json({
      friends: repo.listFriends(me),
      incoming: repo.listIncomingRequests(me),
      outgoing: repo.listOutgoingRequests(me),
    });
  });

  router.post('/request/:userId', (req, res) => {
    const me = req.principal!.userId;
    const target = repo.findUserById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    if (target.id === me) return res.status(400).json({ error: 'Нельзя добавить в друзья самого себя' });
    const result = repo.sendFriendRequest(me, target.id);
    return res.status(result === 'sent' ? 201 : 200).json({ result, state: repo.friendState(me, target.id) });
  });

  router.post('/accept/:userId', (req, res) => {
    const me = req.principal!.userId;
    const requester = repo.findUserById(req.params.userId);
    if (!requester) return res.status(404).json({ error: 'Пользователь не найден' });
    const accepted = repo.acceptFriendRequest(me, requester.id);
    if (!accepted) return res.status(404).json({ error: 'Нет входящей заявки от этого пользователя' });
    return res.json({ ok: true, state: repo.friendState(me, requester.id) });
  });

  router.delete('/:userId', async (req, res) => {
    const me = req.principal!.userId;
    const other = repo.findUserById(req.params.userId);
    if (other) {
      const myself = repo.findUserById(me);
      const reciprocalSubs = [
        ...repo.listSubscriptions(me).filter((s) => s.kind === 'FRIEND' && s.targetId === other.id),
        ...repo.listSubscriptions(other.id).filter((s) => s.kind === 'FRIEND' && s.targetId === me),
      ];
      for (const sub of reciprocalSubs) {
        const subject = sub.targetId === other.id ? other : myself;
        if (subject) await ctx.calendar.removeSubjects(sub, [subject]);
      }
    }
    repo.removeFriendshipAndDependentAccess(me, req.params.userId);
    return res.json({ ok: true });
  });

  return router;
}
