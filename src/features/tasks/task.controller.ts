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
    @Query('columnId') columnId?: string,
    @Query('assignee') assignee?: string,
    @Query('status') status?: string,
  ) {
    return this.tasksService.findForProject(projectId, { columnId, assignee, status });
  }

  @Get('tasks/:taskId/subtasks')
  findSubtasks(@Param('taskId') taskId: string) {
    return this.tasksService.findSubtasks(taskId);
  }

  @Patch('tasks/:taskId')
  update(@Param('taskId') taskId: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(taskId, dto);
  }

  @Patch('tasks/:taskId/move')
  move(@Param('taskId') taskId: string, @Body() dto: MoveTaskDto) {
    return this.tasksService.move(taskId, dto);
  }

  @Delete('tasks/:taskId')
  remove(@Param('taskId') taskId: string) {
    return this.tasksService.remove(taskId);
  }
}
