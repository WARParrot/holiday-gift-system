import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { AppConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { NotificationService } from '../services/notifications.js';
import { canAccessRoom } from '../services/chatAccess.js';
import { verifyToken } from '../util/auth.js';
import type { ChatMessage, CrowdfundingPool, WsClientFrame, WsServerFrame } from '../types/domain.js';

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
 * Security: the socket must authenticate before any join/message. Every join
 * and message is re-checked through `canAccessRoom`, so the birthday subject
 * can never stream their own room even if they craft raw frames.
 */
interface Client {
  socket: WebSocket;
  userId: string | null;
  rooms: Set<string>;
}

export class ChatHub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<Client>();

  constructor(
    server: Server,
    private readonly repo: Repository,
    private readonly config: AppConfig,
    private readonly notifications: NotificationService,
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
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
    let frame: WsClientFrame;
    try {
      frame = JSON.parse(raw) as WsClientFrame;
    } catch {
      return this.send(client.socket, { type: 'error', error: 'Malformed frame' });
    }

    if (frame.type === 'auth') {
      const principal = verifyToken(frame.token, this.config.jwtSecret);
      if (!principal) return this.send(client.socket, { type: 'error', error: 'Invalid token' });
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
      this.notifyOtherParticipants(saved);
      return;
    }
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
        const recipients = this.repo
          .subscriberIdsForSubject(room.subjectId)
          .filter((userId) => userId !== message.authorId);
        if (recipients.length === 0) return;
        this.repo.transaction(() => {
          for (const userId of recipients) {
            this.notifications.push(
              userId,
              'CHAT_MESSAGE',
              `New message in ${room.subjectName}'s celebration chat`,
              `${message.authorName}: ${message.body.slice(0, 80)}`,
              { roomId: room.id, messageId: message.id },
            );
          }
        });
      } catch (err) {
        console.error('Chat notification fan-out failed for message', message.id, err);
      }
    });
  }
}
