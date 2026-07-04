import { Router } from 'express';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { profileSchema } from './schemas.js';
import { checkEligibility } from '../services/chatAccess.js';
import { daysUntilBirthday } from '../util/dates.js';

/**
 * Users, own-profile management, and the aggregated "Friend Card".
 */
export function userRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config, repo));

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
      res.status(404).json({ error: 'Пользователь не найден' });
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
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }

    const groups = repo.listGroupsForUser(subject.id);
    const wishlist = repo.listWishlist(subject.id);

    // Secret chat visibility (positive-authorization model): the subject NEVER
    // sees their own chat. A non-subject sees the live room only once they have
    // explicitly joined (hold a participant grant). If they are merely eligible
    // (subscribe to the subject) we advertise that they can join — but we do NOT
    // create the room here. Room/participant creation is an explicit POST.
    const eligibility = checkEligibility(repo, subject.id, requesterId);
    const existingRoom = repo.getRoomBySubject(subject.id);
    let secretChat:
      | { visible: true; roomId: string }
      | { visible: false; eligible: boolean } = { visible: false, eligible: false };
    if (existingRoom && repo.isParticipant(existingRoom.id, requesterId)) {
      secretChat = { visible: true, roomId: existingRoom.id };
    } else {
      secretChat = { visible: false, eligible: eligibility.eligible };
    }

    res.json({
      user: repo.toPublic(subject),
      daysUntilBirthday: daysUntilBirthday(subject.birthdate),
      groups,
      wishlist,
      secretChat,
      friendState: repo.friendState(requesterId, subject.id),
      isSelf: subject.id === requesterId,
    });
  });

  return router;
}
