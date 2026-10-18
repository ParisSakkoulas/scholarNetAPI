import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';

interface AuthedSocket extends Socket {
  data: { userId?: string };
}

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Real-time chat. Clients connect to the `/chat` namespace with their access token:
 *   io(url + '/chat', { auth: { token } })
 *
 * Client -> server:  message:send {conversationId, text} (ack)   typing:start / typing:stop {conversationId}
 *                    message:read {conversationId}
 * Server -> client:  message:new   typing {conversationId, userId, isTyping}   message:read
 *
 * Every user joins a private room, so all of their devices/tabs receive the same events.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: 'http://localhost:4200', credentials: true },
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MessagesGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly messagesService: MessagesService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---------------- CONNECTION ----------------

  async handleConnection(client: AuthedSocket) {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('missing token');
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      client.data.userId = payload.sub;
      await client.join(userRoom(payload.sub));
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket) {
    if (client.data.userId) this.logger.debug(`User ${client.data.userId} disconnected`);
  }

  // ---------------- CLIENT EVENTS ----------------

  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string; text: string },
  ) {
    const me = client.data.userId;
    if (!me) return { ok: false, error: 'Unauthorized' };
    try {
      const { message, recipientId } = await this.messagesService.sendMessage(
        me,
        body?.conversationId,
        body?.text,
      );
      this.publishMessage(me, recipientId, message);
      return { ok: true, message };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage('typing:start')
  onTypingStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    return this.relayTyping(client, body?.conversationId, true);
  }

  @SubscribeMessage('typing:stop')
  onTypingStop(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    return this.relayTyping(client, body?.conversationId, false);
  }

  @SubscribeMessage('message:read')
  async onRead(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    const me = client.data.userId;
    if (!me) return { ok: false, error: 'Unauthorized' };
    try {
      const res = await this.messagesService.markRead(me, body?.conversationId);
      this.publishRead(me, res);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ---------------- PUBLISHING (also used by the REST controller) ----------------

  publishMessage(senderId: string, recipientId: string, message: unknown) {
    this.server.to(userRoom(recipientId)).to(userRoom(senderId)).emit('message:new', message);
  }

  publishRead(
    readerId: string,
    res: { conversationId: string; otherId: string; readAt: Date; updated: number },
  ) {
    if (!res.updated) return;
    this.server.to(userRoom(res.otherId)).emit('message:read', {
      conversationId: res.conversationId,
      readerId,
      readAt: res.readAt,
    });
  }

  // ---------------- HELPERS ----------------

  private async relayTyping(client: AuthedSocket, conversationId: string, isTyping: boolean) {
    const me = client.data.userId;
    if (!me) return { ok: false };
    const otherId = await this.messagesService.getOtherParticipant(me, conversationId);
    if (!otherId) return { ok: false };
    this.server.to(userRoom(otherId)).emit('typing', { conversationId, userId: me, isTyping });
    return { ok: true };
  }

  private extractToken(client: Socket): string | undefined {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    const raw = fromAuth ?? client.handshake.headers.authorization;
    return raw?.replace(/^Bearer\s+/i, '');
  }
}
