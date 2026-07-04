import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { contributeSchema, messageEditSchema } from './schemas.js';
import { canAccessRoom, checkEligibility } from '../services/chatAccess.js';
import { processMockCharge } from '../services/mockBank.js';

/**
 * Secret chat REST surface (join + history + REST-send fallback) and the
 * crowdfunding "pseudo-bank" pool endpoints.
 *
 * Authorization is a positive model: every room-scoped endpoint flows through
 * `canAccessRoom`, which requires an explicit participant grant (not merely
 * "you aren't the subject"). Materialising a room / participant grant only
 * happens through the explicit POST join below — GET handlers never mutate.
 */
export function chatRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config, notifications } = ctx;
  router.use(requireAuth(config, repo));

  // POST /api/chat/subject/:subjectId/room/join — explicitly join (or open) a
  // subject's celebration chat. Eligibility (a subscription relationship to the
  // subject, and not being the subject) is required; on success the caller is
  // recorded as a participant. This is the ONLY place a room/grant is created.
  router.post('/subject/:subjectId/room/join', (req, res) => {
    const requesterId = req.principal!.userId;
    const subjectId = req.params.subjectId;
    const subject = repo.findUserById(subjectId);
    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }
    const eligibility = checkEligibility(repo, subjectId, requesterId);
    if (!eligibility.eligible) {
      // The birthday person (or a stranger with no relationship) gets a hard
      // 403 — they must not learn whether the room exists.
      res.status(403).json({ error: 'This chat is not available to you' });
      return;
    }
    const existingRoom = repo.getRoomBySubject(subjectId);
    const room = existingRoom ?? repo.getOrCreateRoomForSubject(subjectId, randomUUID());
    // First joiner opens the room and is its organizer; later joiners are
    // regular participants. Idempotent — re-joining is a no-op.
    const role = existingRoom || repo.listParticipants(room.id).length > 0 ? 'PARTICIPANT' : 'ORGANIZER';
    repo.addParticipant(room.id, requesterId, role, eligibility.source ?? 'FRIEND');
    res.status(201).json({
      room,
      pool: repo.getPoolByRoom(room.id) ?? null,
      participants: repo.listParticipants(room.id),
    });
  });

  // GET /api/chat/rooms/:roomId — room metadata + participants (participants only)
  router.get('/rooms/:roomId', (req, res) => {
    const access = canAccessRoom(repo, req.params.roomId, req.principal!.userId);
    if (!access.allowed) {
      res.status(access.reason === 'ROOM_NOT_FOUND' ? 404 : 403).json({
        error: access.reason === 'ROOM_NOT_FOUND' ? 'Room not found' : 'This chat is not available to you',
      });
      return;
    }
    res.json({
      room: repo.getRoomById(req.params.roomId),
      participants: repo.listParticipants(req.params.roomId),
      pool: repo.getPoolByRoom(req.params.roomId) ?? null,
    });
  });

  // GET /api/chat/rooms/:roomId/messages — message history (paginated).
  // Query: ?limit=N (1..200, default 100), ?before=<ISO cursor> for older pages.
  router.get('/rooms/:roomId/messages', (req, res) => {
    const access = canAccessRoom(repo, req.params.roomId, req.principal!.userId);
    if (!access.allowed) {
      res.status(access.reason === 'ROOM_NOT_FOUND' ? 404 : 403).json({
        error: access.reason === 'ROOM_NOT_FOUND' ? 'Room not found' : 'This chat is not available to you',
      });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const messages = repo.listMessages(req.params.roomId, { limit, before });
    // `nextBefore` is the cursor (oldest message's id) for the previous (older)
    // page; null when the page wasn't full (no older messages remain).
    const nextBefore = messages.length && limit && messages.length >= limit ? messages[0].id : null;
    res.json({ messages, nextBefore });
  });

  // POST /api/chat/rooms/:roomId/messages — REST fallback for sending (WS preferred)
  router.post('/rooms/:roomId/messages', (req, res) => {
    const access = canAccessRoom(repo, req.params.roomId, req.principal!.userId);
    if (!access.allowed) {
      res.status(access.reason === 'ROOM_NOT_FOUND' ? 404 : 403).json({
        error: access.reason === 'ROOM_NOT_FOUND' ? 'Room not found' : 'This chat is not available to you',
      });
      return;
    }
    const body = String((req.body as { body?: unknown }).body ?? '').trim();
    if (!body) {
      res.status(400).json({ error: 'Message body is required' });
      return;
    }
    if (body.length > 4000) {
      res.status(400).json({ error: 'Message exceeds the 4000-character limit' });
      return;
    }
    const message = repo.addMessage({
      id: randomUUID(),
      roomId: req.params.roomId,
      authorId: req.principal!.userId,
      body,
    });
    // Behavioural parity with the WS path: broadcast to live clients, clear the
    // author's own chat counter for this room, and fan out subscriber
    // notifications. Previously REST-sent messages skipped notifications.
    ctx.hub.current?.broadcastToRoom(req.params.roomId, { type: 'message', message });
    ctx.hub.current?.onMessagePosted(message);
    res.status(201).json({ message });
  });

  router.patch('/rooms/:roomId/messages/:messageId', (req, res) => {
    const requesterId = req.principal!.userId;
    const access = canAccessRoom(repo, req.params.roomId, requesterId);
    if (!access.allowed) {
      res.status(access.reason === 'ROOM_NOT_FOUND' ? 404 : 403).json({ error: 'This chat is not available to you' });
      return;
    }
    const existing = repo.getMessage(req.params.messageId);
    if (!existing || existing.roomId !== req.params.roomId) return res.status(404).json({ error: 'Message not found' });
    if (existing.authorId !== requesterId) return res.status(403).json({ error: 'You can only edit your own messages' });
    const body = parseBody(messageEditSchema, req.body, res);
    if (!body) return;
    const message = repo.updateMessage(existing.id, body.body)!;
    ctx.hub.current?.broadcastToRoom(req.params.roomId, { type: 'message-updated', message });
    return res.json({ message });
  });

  router.delete('/rooms/:roomId/messages/:messageId', (req, res) => {
    const requesterId = req.principal!.userId;
    const access = canAccessRoom(repo, req.params.roomId, requesterId);
    if (!access.allowed) {
      res.status(access.reason === 'ROOM_NOT_FOUND' ? 404 : 403).json({ error: 'This chat is not available to you' });
      return;
    }
    const existing = repo.getMessage(req.params.messageId);
    if (!existing || existing.roomId !== req.params.roomId) return res.status(404).json({ error: 'Message not found' });
    if (existing.authorId !== requesterId) return res.status(403).json({ error: 'You can only delete your own messages' });
    repo.deleteMessage(existing.id);
    ctx.hub.current?.broadcastToRoom(req.params.roomId, { type: 'message-deleted', id: existing.id, roomId: req.params.roomId });
    return res.json({ ok: true });
  });

  // GET /api/chat/rooms/:roomId/pool — pool + contributions
  router.get('/rooms/:roomId/pool', (req, res) => {
    const access = canAccessRoom(repo, req.params.roomId, req.principal!.userId);
    if (!access.allowed) {
      res.status(access.reason === 'ROOM_NOT_FOUND' ? 404 : 403).json({ error: 'Not available' });
      return;
    }
    const pool = repo.getPoolByRoom(req.params.roomId);
    if (!pool) {
      res.json({ pool: null, contributions: [] });
      return;
    }
    res.json({ pool, contributions: repo.listContributions(pool.id) });
  });

  // POST /api/chat/rooms/:roomId/pool/contribute — contribute via the mock bank
  router.post('/rooms/:roomId/pool/contribute', (req, res) => {
    const requesterId = req.principal!.userId;
    const access = canAccessRoom(repo, req.params.roomId, requesterId);
    if (!access.allowed) {
      res.status(access.reason === 'ROOM_NOT_FOUND' ? 404 : 403).json({ error: 'Not available' });
      return;
    }
    const body = parseBody(contributeSchema, req.body, res);
    if (!body) return;
    const pool = repo.getPoolByRoom(req.params.roomId);
    if (!pool) {
      res.status(404).json({ error: 'No open pool for this room' });
      return;
    }
    if (pool.status !== 'OPEN') {
      res.status(409).json({ error: 'This pool is closed to new contributions' });
      return;
    }

    // Contributions are funded from the user's wallet balance. Debit first
    // (atomic, rejects overdraw), then record the pool contribution.
    const balance = repo.getBalance(requesterId);
    if (balance < body.amount) {
      res.status(402).json({
        error: `Insufficient balance. Your balance is ${balance.toFixed(2)}; top up on the Payment page.`,
      });
      return;
    }

    const charge = processMockCharge({
      userId: requesterId,
      amount: body.amount,
      targetAmount: pool.targetAmount,
      currentBalance: pool.currentBalance,
    });
    if (!charge.ok) {
      res.status(402).json({ error: charge.error ?? 'Payment failed' });
      return;
    }

    const debit = repo.applyWalletTransaction({
      id: randomUUID(),
      userId: requesterId,
      kind: 'CONTRIBUTION',
      amount: -charge.processedAmount,
      memo: `Gift pool for ${pool.subjectName}`,
      txRef: charge.txRef,
    });
    if (!debit) {
      res.status(402).json({ error: 'Insufficient balance' });
      return;
    }

    const updated = repo.addContribution({
      id: randomUUID(),
      poolId: pool.id,
      contributorId: requesterId,
      contributorName: '',
      amount: charge.processedAmount,
      txRef: charge.txRef,
      createdAt: new Date().toISOString(),
    });

    // Live-update everyone watching the room and notify subscribers.
    ctx.hub.current?.publishPool(updated);
    notifications.push(
      requesterId,
      'SYSTEM',
      'Contribution received',
      `Your contribution of ${charge.processedAmount} to ${pool.subjectName}'s gift pool was recorded (${charge.txRef}). New balance: ${debit.balanceAfter.toFixed(2)}.`,
      { poolId: pool.id, txRef: charge.txRef },
    );

    res.status(201).json({ pool: updated, txRef: charge.txRef, balance: debit.balanceAfter });
  });

  return router;
}
