import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TeamRoleGuard } from './guards/team-role.guard';
import { Roles } from './decorators/roles.decorator';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@UseGuards(JwtAuthGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  create(@Body() dto: CreateTeamDto, @Req() req) {
    return this.teamsService.create(dto, req.user._id);
  }

  @Get()
  findAllForUser(@Req() req) {
    return this.teamsService.findAllForUser(req.user._id);
  }

  @Get(':teamId')
  @UseGuards(TeamRoleGuard)
  findOne(@Param('teamId') teamId: string) {
    return this.teamsService.findOne(teamId);
  }

  @Patch(':teamId')
  @UseGuards(TeamRoleGuard)
  @Roles('admin', 'owner')
  update(@Param('teamId') teamId: string, @Body() dto: UpdateTeamDto) {
    return this.teamsService.update(teamId, dto);
  }

  @Delete(':teamId')
  @UseGuards(TeamRoleGuard)
  remove(@Param('teamId') teamId: string, @Req() req) {
    return this.teamsService.remove(teamId, req.user._id);
  }
}
