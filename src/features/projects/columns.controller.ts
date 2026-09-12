import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ColumnsService } from './columns.service';
import { CreateColumnDto } from './dto/create-column.dto';

@UseGuards(JwtAuthGuard)
@Controller('boards/:boardId/columns')
export class ColumnsController {
  constructor(private readonly columnsService: ColumnsService) {}

  @Post()
  create(@Param('boardId') boardId: string, @Body() dto: CreateColumnDto) {
    return this.columnsService.create(boardId, dto);
  }

  @Get()
  findForBoard(@Param('boardId') boardId: string) {
    return this.columnsService.findForBoard(boardId);
  }

  @Patch(':columnId')
  update(@Param('columnId') columnId: string, @Body() dto: CreateColumnDto) {
    return this.columnsService.update(columnId, dto);
  }

  @Delete(':columnId')
  remove(@Param('columnId') columnId: string) {
    return this.columnsService.remove(columnId);
  }
}
