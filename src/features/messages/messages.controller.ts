import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { parsePaging } from 'src/common/utils/paging';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';

/** REST side of chat: list/open conversations, load history. Live delivery happens over the socket. */
@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly gateway: MessagesGateway,
  ) {}

  /** GET /messages/conversations?page=1&limit=20 */
  @Get('conversations')
  conversations(
    @CurrentUser() user,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parsePaging(page, limit);
    return this.messagesService.listConversations(user.userId, p.page, p.limit, p.skip);
  }

  /** POST /messages/conversations  { userId } - open (or create) a chat with a connected user */
  @Post('conversations')
  open(@CurrentUser() user, @Body('userId') userId: string) {
    return this.messagesService.getOrCreateConversation(user.userId, userId);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user) {
    return this.messagesService.getUnreadTotal(user.userId);
  }

  /** GET /messages/conversations/:id/messages?limit=30&before=<messageId> (newest first) */
  @Get('conversations/:id/messages')
  history(
    @CurrentUser() user,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const p = parsePaging(undefined, limit, 100);
    return this.messagesService.getMessages(user.userId, id, p.limit, before);
  }

  /** HTTP fallback for sending; still pushes the message to connected sockets. */
  @Post('conversations/:id/messages')
  async send(@CurrentUser() user, @Param('id') id: string, @Body('text') text: string) {
    const { message, recipientId } = await this.messagesService.sendMessage(user.userId, id, text);
    this.gateway.publishMessage(user.userId, recipientId, message);
    return message;
  }

  @Patch('conversations/:id/read')
  async read(@CurrentUser() user, @Param('id') id: string) {
    const res = await this.messagesService.markRead(user.userId, id);
    this.gateway.publishRead(user.userId, res);
    return { updated: res.updated };
  }
}
