import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { parsePaging } from 'src/common/utils/paging';
import { FollowsService } from './follows.service';

@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  // ---------------- ACTIONS (logged-in user) ----------------

  @Post(':userId')
  @UseGuards(JwtAuthGuard)
  follow(@CurrentUser() user, @Param('userId') userId: string) {
    return this.followsService.follow(user.userId, userId);
  }

  @Delete(':userId')
  @UseGuards(JwtAuthGuard)
  unfollow(@CurrentUser() user, @Param('userId') userId: string) {
    return this.followsService.unfollow(user.userId, userId);
  }

  /** Am I following :userId / does :userId follow me? */
  @Get(':userId/status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user, @Param('userId') userId: string) {
    return this.followsService.getStatus(user.userId, userId);
  }

  // ---------------- PUBLIC (profiles are public) ----------------

  @Get(':userId/counts')
  counts(@Param('userId') userId: string) {
    return this.followsService.getCounts(userId);
  }

  @Get(':userId/followers')
  followers(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parsePaging(page, limit);
    return this.followsService.getFollowers(userId, p.page, p.limit, p.skip);
  }

  @Get(':userId/following')
  following(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parsePaging(page, limit);
    return this.followsService.getFollowing(userId, p.page, p.limit, p.skip);
  }
}
