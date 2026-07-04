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
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === me) return res.status(400).json({ error: 'You cannot friend yourself' });
    const result = repo.sendFriendRequest(me, target.id);
    return res.status(result === 'sent' ? 201 : 200).json({ result, state: repo.friendState(me, target.id) });
  });

  router.post('/accept/:userId', (req, res) => {
    const me = req.principal!.userId;
    const requester = repo.findUserById(req.params.userId);
    if (!requester) return res.status(404).json({ error: 'User not found' });
    const accepted = repo.acceptFriendRequest(me, requester.id);
    if (!accepted) return res.status(404).json({ error: 'No pending request from this user' });
    return res.json({ ok: true, state: repo.friendState(me, requester.id) });
  });

  router.delete('/:userId', (req, res) => {
    const me = req.principal!.userId;
    repo.removeFriendship(me, req.params.userId);
    return res.json({ ok: true });
  });

  return router;
}
