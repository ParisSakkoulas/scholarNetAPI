import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TeamMembersService } from './team-members.service';

/**
 * Invitations from the point of view of the invited user. These can't live in
 * TeamMembersController: its TeamRoleGuard only admits *active* members, and an
 * invited user is not a member yet.
 */
@Controller('teams/invitations')
@UseGuards(JwtAuthGuard)
export class TeamInvitationsController {
  constructor(private readonly membersService: TeamMembersService) {}

  @Get('me')
  mine(@CurrentUser() user) {
    return this.membersService.listInvitations(user.userId);
  }

  @Post(':teamId/accept')
  accept(@CurrentUser() user, @Param('teamId') teamId: string) {
    return this.membersService.accept(teamId, user.userId);
  }

  @Post(':teamId/decline')
  decline(@CurrentUser() user, @Param('teamId') teamId: string) {
    return this.membersService.decline(teamId, user.userId);
  }
}
