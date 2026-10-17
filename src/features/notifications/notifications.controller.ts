import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { parsePaging } from 'src/common/utils/paging';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification-type.enum';

/** Every route only ever touches the notifications of the logged-in user. */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** GET /notifications?page=1&limit=20&unread=true&type=NEW_FOLLOWER */
  @Get()
  list(
    @CurrentUser() user,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unread') unread?: string,
    @Query('type') type?: string,
  ) {
    if (type && !Object.values(NotificationType).includes(type as NotificationType)) {
      throw new BadRequestException('Unknown notification type.');
    }
    return this.notificationsService.findForUser(user.userId, {
      ...parsePaging(page, limit),
      unreadOnly: unread === 'true',
      type: type as NotificationType | undefined,
    });
  }

  /** Badge counter for the bell icon. */
  @Get('unread-count')
  unreadCount(@CurrentUser() user) {
    return this.notificationsService.unreadCount(user.userId);
  }

  // static routes are declared before ':id' so they are not captured by it
  @Patch('read-all')
  markAllRead(@CurrentUser() user) {
    return this.notificationsService.markAllRead(user.userId);
  }

  /** DELETE /notifications?onlyRead=true clears read ones; without the flag clears everything. */
  @Delete()
  clear(@CurrentUser() user, @Query('onlyRead') onlyRead?: string) {
    return this.notificationsService.clear(user.userId, onlyRead === 'true');
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user, @Param('id') id: string) {
    return this.notificationsService.markRead(user.userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user, @Param('id') id: string) {
    return this.notificationsService.remove(user.userId, id);
  }
}
