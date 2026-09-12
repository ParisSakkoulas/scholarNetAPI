import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TeamRoleGuard } from './guards/team-role.guard';
import { Roles } from './decorators/roles.decorator';
import { TeamMembersService } from './team-members.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@UseGuards(JwtAuthGuard, TeamRoleGuard)
@Controller('teams/:teamId/members')
export class TeamMembersController {
  constructor(private readonly membersService: TeamMembersService) {}

  @Post()
  @Roles('admin', 'owner')
  invite(@Param('teamId') teamId: string, @Body() dto: InviteMemberDto, @Req() req) {
    return this.membersService.invite(teamId, dto, req.user._id);
  }

  @Get()
  list(@Param('teamId') teamId: string) {
    return this.membersService.list(teamId);
  }

  @Post('accept')
  accept(@Param('teamId') teamId: string, @Req() req) {
    return this.membersService.accept(teamId, req.user._id);
  }

  @Patch(':userId')
  @Roles('admin', 'owner')
  updateRole(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.membersService.updateRole(teamId, userId, dto);
  }

  @Delete(':userId')
  @Roles('admin', 'owner')
  remove(@Param('teamId') teamId: string, @Param('userId') userId: string) {
    return this.membersService.remove(teamId, userId);
  }
}
