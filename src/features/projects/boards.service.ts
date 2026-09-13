import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Board, BoardDocument } from './schema/board.schema';
import { Column, ColumnDocument } from './schema/column.schema';
import { CreateBoardDto } from './dto/create-board.dto';

@Injectable()
export class BoardsService {
  constructor(
    @InjectModel(Board.name) private boardModel: Model<BoardDocument>,
    @InjectModel(Column.name) private columnModel: Model<ColumnDocument>,
  ) {}

  async create(projectId: string, dto: CreateBoardDto) {
    const last = await this.boardModel
      .findOne({ projectId: new Types.ObjectId(projectId) })
      .sort({ position: -1 })
      .lean();
    const position = dto.position ?? (last?.position ?? 0) + 1000;
    return this.boardModel.create({
      ...dto,
      projectId: new Types.ObjectId(projectId),
      position,
    });
  }

  async findForProject(projectId: string) {
    return this.boardModel
      .find({ projectId: new Types.ObjectId(projectId) })
      .sort({ position: 1 })
      .lean();
  }

  async update(boardId: string, dto: CreateBoardDto) {
    const board = await this.boardModel.findByIdAndUpdate(boardId, dto, { new: true });
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  async remove(boardId: string) {
    const res = await this.boardModel.findByIdAndDelete(boardId);
    if (!res) throw new NotFoundException('Board not found');
    await this.columnModel.deleteMany({ boardId: new Types.ObjectId(boardId) });
    return { deleted: true };
  }
}
