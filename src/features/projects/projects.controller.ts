import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../teams/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TeamRoleGuard } from '../teams/guards/team-role.guard';

import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post('teams/:teamId/projects')
  @UseGuards(TeamRoleGuard)
  @Roles('admin', 'owner', 'member')
  create(@Param('teamId') teamId: string, @Body() dto: CreateProjectDto, @Req() req) {
    return this.projectsService.create(teamId, dto, req.user._id);
  }

  @Get('teams/:teamId/projects')
  @UseGuards(TeamRoleGuard)
  findForTeam(@Param('teamId') teamId: string, @Query('status') status?: string) {
    return this.projectsService.findForTeam(teamId, status);
  }

  @Get('projects/:projectId')
  findOne(@Param('projectId') projectId: string) {
    return this.projectsService.findOne(projectId);
  }

  @Patch('projects/:projectId')
  update(@Param('projectId') projectId: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(projectId, dto);
  }

  @Delete('projects/:projectId')
  remove(@Param('projectId') projectId: string) {
    return this.projectsService.remove(projectId);
  }
}
