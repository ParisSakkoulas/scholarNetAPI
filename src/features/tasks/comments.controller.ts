import { Controller, Get, Post, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';

@UseGuards(JwtAuthGuard)
@Controller('tasks/:taskId/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  create(@Param('taskId') taskId: string, @Body() dto: CreateCommentDto, @Req() req) {
    return this.commentsService.create('task', taskId, dto, req.user._id);
  }

  @Get()
  findForTask(@Param('taskId') taskId: string) {
    return this.commentsService.findForEntity('task', taskId);
  }

  @Delete(':commentId')
  remove(@Param('commentId') commentId: string, @Req() req) {
    return this.commentsService.remove(commentId, req.user._id);
  }
}
