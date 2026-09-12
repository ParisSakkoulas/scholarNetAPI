import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/boards')
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  create(@Param('projectId') projectId: string, @Body() dto: CreateBoardDto) {
    return this.boardsService.create(projectId, dto);
  }

  @Get()
  findForProject(@Param('projectId') projectId: string) {
    return this.boardsService.findForProject(projectId);
  }

  @Patch(':boardId')
  update(@Param('boardId') boardId: string, @Body() dto: CreateBoardDto) {
    return this.boardsService.update(boardId, dto);
  }

  @Delete(':boardId')
  remove(@Param('boardId') boardId: string) {
    return this.boardsService.remove(boardId);
  }
}
