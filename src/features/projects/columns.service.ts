import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Column, ColumnDocument } from './schema/column.schema';
import { CreateColumnDto } from './dto/create-column.dto';

@Injectable()
export class ColumnsService {
  constructor(@InjectModel(Column.name) private columnModel: Model<ColumnDocument>) {}

  async create(boardId: string, dto: CreateColumnDto) {
    const last = await this.columnModel.findOne({ boardId }).sort({ position: -1 }).lean();
    const position = dto.position ?? (last?.position ?? 0) + 1000;
    return this.columnModel.create({ ...dto, boardId, position });
  }

  async findForBoard(boardId: string) {
    return this.columnModel.find({ boardId }).sort({ position: 1 }).lean();
  }

  async update(columnId: string, dto: CreateColumnDto) {
    const column = await this.columnModel.findByIdAndUpdate(columnId, dto, { new: true });
    if (!column) throw new NotFoundException('Column not found');
    return column;
  }

  async remove(columnId: string) {
    const res = await this.columnModel.findByIdAndDelete(columnId);
    if (!res) throw new NotFoundException('Column not found');
    return { deleted: true };
  }
}
