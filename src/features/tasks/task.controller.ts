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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TasksService } from './task.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('projects/:projectId/tasks')
  create(@Param('projectId') projectId: string, @Body() dto: CreateTaskDto, @Req() req) {
    return this.tasksService.create(projectId, dto, req.user._id);
  }

  @Get('projects/:projectId/tasks')
  findForProject(
    @Param('projectId') projectId: string,
    @Query('columnId') columnId: string | undefined,
    @Query('assignee') assignee: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req,
  ) {
    return this.tasksService.findForProject(projectId, { columnId, assignee, status }, req.user._id);
  }

  @Get('tasks/:taskId/subtasks')
  findSubtasks(@Param('taskId') taskId: string, @Req() req) {
    return this.tasksService.findSubtasks(taskId, req.user._id);
  }

  @Patch('tasks/:taskId')
  update(@Param('taskId') taskId: string, @Body() dto: UpdateTaskDto, @Req() req) {
    return this.tasksService.update(taskId, dto, req.user._id);
  }

  @Patch('tasks/:taskId/move')
  move(@Param('taskId') taskId: string, @Body() dto: MoveTaskDto, @Req() req) {
    return this.tasksService.move(taskId, dto, req.user._id);
  }

  /** Admin / owner: sign off a completed task. */
  @Post('tasks/:taskId/approve')
  approve(@Param('taskId') taskId: string, @Req() req) {
    return this.tasksService.approve(taskId, req.user._id);
  }

  /** Admin / owner: withdraw the approval, e.g. the work needs another pass. */
  @Post('tasks/:taskId/unapprove')
  unapprove(@Param('taskId') taskId: string, @Req() req) {
    return this.tasksService.unapprove(taskId, req.user._id);
  }

  @Delete('tasks/:taskId')
  remove(@Param('taskId') taskId: string, @Req() req) {
    return this.tasksService.remove(taskId, req.user._id);
  }
}
