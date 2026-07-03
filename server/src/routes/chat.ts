import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { contributeSchema } from './schemas.js';
import { canAccessRoom, canAccessSubjectChat } from '../services/chatAccess.js';
import { processMockCharge } from '../services/mockBank.js';

/**
 * Secret chat REST surface (history + REST-send fallback) and the crowdfunding
 * "pseudo-bank" pool endpoints. All room access flows through canAccessRoom so
 * the subject is excluded here exactly as in the WebSocket hub.
 */
export function chatRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config, notifications } = ctx;
  router.use(requireAuth(config));

  // GET /api/chat/subject/:subjectId/room — resolve (or create) a subject's room
  router.get('/subject/:subjectId/room', (req, res) => {
    const requesterId = req.principal!.userId;
    const subjectId = req.params.subjectId;
    const subject = repo.findUserById(subjectId);
    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }
    const access = canAccessSubjectChat(subjectId, requesterId);
    if (!access.allowed) {
      // The birthday person gets a hard 403 — they must not even learn the room exists.
      res.status(403).json({ error: 'This chat is not available to you' });
      return;
    }
    const room = repo.getOrCreateRoomForSubject(subjectId, randomUUID());
    res.json({ room, pool: repo.getPoolByRoom(room.id) ?? null });
  });

  // GET /api/chat/rooms/:roomId/messages — message history
  router.get('/rooms/:roomId/messages', (req, res) => {
    const access = canAccessRoom(repo, req.params.roomId, req.principal!.userId);
    if (!access.allowed) {
      res.status(access.reason === 'ROOM_NOT_FOUND' ? 404 : 403).json({
        error: access.reason === 'ROOM_NOT_FOUND' ? 'Room not found' : 'This chat is not available to you',
      });
      return;
    }
    res.json({ messages: repo.listMessages(req.params.roomId) });
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
    const message = repo.addMessage({
      id: randomUUID(),
      roomId: req.params.roomId,
      authorId: req.principal!.userId,
      body,
    });
    ctx.hub.current?.broadcastToRoom(req.params.roomId, { type: 'message', message });
    res.status(201).json({ message });
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
