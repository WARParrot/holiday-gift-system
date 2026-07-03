import { Router } from 'express';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { profileSchema } from './schemas.js';
import { canAccessSubjectChat } from '../services/chatAccess.js';
import { daysUntilBirthday } from '../util/dates.js';

/**
 * Users, own-profile management, and the aggregated "Friend Card".
 */
export function userRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config));

  // GET /api/users  — global directory (scenario 1: Discovery & Directory)
  router.get('/', (req, res) => {
    const me = req.principal!.userId;
    const users = repo.allUsers().map((u) => ({
      ...repo.toPublic(u),
      daysUntilBirthday: daysUntilBirthday(u.birthdate),
      isSelf: u.id === me,
    }));
    users.sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);
    res.json({ users });
  });

  // GET /api/users/me
  router.get('/me', (req, res) => {
    const user = repo.findUserById(req.principal!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user: repo.toPublic(user) });
  });

  // PUT /api/users/me  — profile management
  router.put('/me', (req, res) => {
    const body = parseBody(profileSchema, req.body, res);
    if (!body) return;
    repo.updateUserProfile(req.principal!.userId, body.fullName, body.birthdate, body.avatarUrl ?? null);
    res.json({ user: repo.toPublic(repo.findUserById(req.principal!.userId)!) });
  });

  // GET /api/users/:id/card  — the aggregated Friend Card
  router.get('/:id/card', (req, res) => {
    const requesterId = req.principal!.userId;
    const subject = repo.findUserById(req.params.id);
    if (!subject) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const groups = repo.listGroupsForUser(subject.id);
    const wishlist = repo.listWishlist(subject.id);

    // Secret chat visibility: the subject must NEVER see their own chat.
    const access = canAccessSubjectChat(subject.id, requesterId);
    let secretChat: { roomId: string; visible: true } | { visible: false } = { visible: false };
    if (access.allowed) {
      // Lazily materialise the room so the chat pane has a target id.
      const room = repo.getOrCreateRoomForSubject(subject.id, cryptoRandom());
      secretChat = { roomId: room.id, visible: true };
    }

    res.json({
      user: repo.toPublic(subject),
      daysUntilBirthday: daysUntilBirthday(subject.birthdate),
      groups,
      wishlist,
      secretChat,
      isSelf: subject.id === requesterId,
    });
  });

  return router;
}

// Local uuid helper to avoid importing crypto in multiple spots.
function cryptoRandom(): string {
  return globalThis.crypto.randomUUID();
}
