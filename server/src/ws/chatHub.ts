import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { NotificationService } from '../services/notifications.js';
import { canAccessRoom } from '../services/chatAccess.js';
import { verifyToken } from '../util/auth.js';
import type { ChatMessage, CrowdfundingPool, Notification, WsServerFrame } from '../types/domain.js';

/**
 * Real-time hub for the Secret Coordination Chat.
 *
 * Protocol (JSON frames over a single WS connection on `/ws`):
 *   client -> { type: 'auth', token }          authenticate the socket
 *   server -> { type: 'ready', userId }
 *   client -> { type: 'join', roomId }          subscribe to a room's stream
 *   server -> { type: 'joined', roomId, messages }   backlog on join
 *   client -> { type: 'message', roomId, body } send a message
 *   server -> { type: 'message', message }      broadcast to everyone in room
 *   server -> { type: 'pool', pool }            live crowdfunding updates
 *   server -> { type: 'error', error }
 *
 * Security:
 *  - The socket must authenticate before any join/message.
 *  - Every join and message is re-checked through `canAccessRoom`, which under
 *    the positive-authorization model requires an explicit participant grant
 *    (a subject or a stranger without a grant is rejected even with raw frames).
 *  - Every inbound frame is schema-validated (shape + types + max body length)
 *    before it is trusted, so a malformed/oversized frame can't reach the DB.
 */
interface Client {
  socket: WebSocket;
  userId: string | null;
  rooms: Set<string>;
}

/** Max characters accepted in a single chat message (WS and REST agree). */
const MAX_MESSAGE_LENGTH = 4000;
/** Max bytes accepted for a single inbound WS frame before we drop it. */
const MAX_FRAME_BYTES = 64 * 1024;

const wsClientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('join'), roomId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('message'), roomId: z.string().min(1).max(128), body: z.string().min(1).max(MAX_MESSAGE_LENGTH) }),
]);

export class ChatHub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<Client>();

  constructor(
    server: Server,
    private readonly repo: Repository,
    private readonly config: AppConfig,
    private readonly notifications: NotificationService,
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME_BYTES });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  private onConnection(socket: WebSocket): void {
    const client: Client = { socket, userId: null, rooms: new Set() };
    this.clients.add(client);
    socket.on('message', (raw) => this.onMessage(client, raw.toString()));
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  private send(socket: WebSocket, frame: WsServerFrame): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }

  private onMessage(client: Client, raw: string): void {
    if (raw.length > MAX_FRAME_BYTES) {
      return this.send(client.socket, { type: 'error', error: 'Frame too large' });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.send(client.socket, { type: 'error', error: 'Malformed frame' });
    }
    const result = wsClientFrameSchema.safeParse(parsed);
    if (!result.success) {
      return this.send(client.socket, { type: 'error', error: 'Invalid frame' });
    }
    const frame = result.data;

    if (frame.type === 'auth') {
      const principal = verifyToken(frame.token, this.config.jwtSecret);
      if (!principal) return this.send(client.socket, { type: 'error', error: 'Invalid token' });
      // Re-validate against the DB: a token for a since-deleted user must not
      // grant a live socket (mirrors the REST auth re-check).
      if (!this.repo.findUserById(principal.userId)) {
        return this.send(client.socket, { type: 'error', error: 'Invalid token' });
      }
      client.userId = principal.userId;
      return this.send(client.socket, { type: 'ready', userId: principal.userId });
    }

    if (!client.userId) {
      return this.send(client.socket, { type: 'error', error: 'Not authenticated' });
    }

    if (frame.type === 'join') {
      const decision = canAccessRoom(this.repo, frame.roomId, client.userId);
      if (!decision.allowed) {
        return this.send(client.socket, { type: 'error', error: `Access denied (${decision.reason})` });
      }
      client.rooms.add(frame.roomId);
      const messages = this.repo.listMessages(frame.roomId);
      this.send(client.socket, { type: 'joined', roomId: frame.roomId, messages });
      const pool = this.repo.getPoolByRoom(frame.roomId);
      if (pool) this.send(client.socket, { type: 'pool', pool });
      return;
    }

    if (frame.type === 'message') {
      const decision = canAccessRoom(this.repo, frame.roomId, client.userId);
      if (!decision.allowed) {
        return this.send(client.socket, { type: 'error', error: `Access denied (${decision.reason})` });
      }
      const body = frame.body.trim();
      if (!body) return;
      const saved = this.repo.addMessage({
        id: randomUUID(),
        roomId: frame.roomId,
        authorId: client.userId,
        body,
      });
      this.broadcastToRoom(frame.roomId, { type: 'message', message: saved });
      this.onMessagePosted(saved);
      return;
    }
  }

  /**
   * Post-persist side effects shared by BOTH the WS and REST send paths:
   *   - drop the author's own chat-counter notification for the room (req 2),
   *   - fan out chat notifications to other subscribers (req 1/3).
   * Calling this from the REST route closes the prior parity gap where
   * REST-sent messages skipped subscriber notifications entirely.
   */
  onMessagePosted(message: ChatMessage): void {
    this.clearChatNotification(message.authorId, message.roomId);
    this.notifyOtherParticipants(message);
  }

  /** Broadcast a frame to every authenticated client currently in the room. */
  broadcastToRoom(roomId: string, frame: WsServerFrame): void {
    for (const client of this.clients) {
      if (client.userId && client.rooms.has(roomId)) {
        this.send(client.socket, frame);
      }
    }
  }

  /** Push a live crowdfunding update to a room (called by the REST pool route). */
  publishPool(pool: CrowdfundingPool): void {
    this.broadcastToRoom(pool.roomId, { type: 'pool', pool });
  }

  /** Send a frame to every authenticated socket belonging to a single user. */
  private sendToUser(userId: string, frame: WsServerFrame): void {
    for (const client of this.clients) {
      if (client.userId === userId) this.send(client.socket, frame);
    }
  }

  /**
   * Deliver a fresh/updated notification to a user's connected clients so the
   * notification bell updates live. Wired to `NotificationService`'s onNotify
   * sink in index.ts. Clients need only an authenticated socket (no room join).
   */
  publishNotification(userId: string, notification: Notification): void {
    this.sendToUser(userId, { type: 'notification', notification });
  }

  /** User ids that currently have this room open (an active joined socket). */
  private usersInRoom(roomId: string): Set<string> {
    const present = new Set<string>();
    for (const client of this.clients) {
      if (client.userId && client.rooms.has(roomId)) present.add(client.userId);
    }
    return present;
  }

  /** Remove a user's chat-counter notification for a room and tell their clients. */
  private clearChatNotification(userId: string, roomId: string): void {
    const removedId = this.repo.deleteNotificationByDedupe(userId, `chat:${roomId}`);
    if (removedId) this.sendToUser(userId, { type: 'notification-removed', id: removedId });
  }

  private notifyOtherParticipants(message: ChatMessage): void {
    // The message itself is already persisted and broadcast to the room by the
    // time we get here, so the notification fan-out is deferred off the send
    // hot path (setImmediate) and its per-recipient inserts are collapsed into
    // a single transaction — one commit/fsync instead of one per subscriber.
    setImmediate(() => {
      // This runs detached from the send flow, so any throw here would surface
      // as an uncaughtException and could crash the process. The message is
      // already persisted and delivered, so a failed fan-out must never take
      // the server down — swallow and log it instead.
      try {
        const room = this.repo.getRoomById(message.roomId);
        if (!room) return;
        // Only subscribers are notified (req 3 — subscriberIdsForSubject already
        // excludes non-subscribers and the subject). We further skip the author
        // and anyone currently viewing the room (req 1).
        const present = this.usersInRoom(message.roomId);
        const recipients = this.repo
          .subscriberIdsForSubject(room.subjectId)
          .filter((userId) => userId !== message.authorId && !present.has(userId));
        if (recipients.length === 0) return;
        this.repo.transaction(() => {
          for (const userId of recipients) {
            this.notifications.pushChatMessage(userId, room, message);
          }
        });
      } catch (err) {
        console.error('Chat notification fan-out failed for message', message.id, err);
      }
    });
  }
}
