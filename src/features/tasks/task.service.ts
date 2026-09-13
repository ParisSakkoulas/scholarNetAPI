import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument } from './schema/task.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { Column, ColumnDocument } from '../projects/schema/column.schema';

interface TaskFilters {
  columnId?: string;
  assignee?: string;
  status?: string;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Column.name) private columnModel: Model<ColumnDocument>,
  ) {}

  async create(projectId: string, dto: CreateTaskDto, createdBy: string) {
    const last = await this.taskModel
      .findOne({ columnId: new Types.ObjectId(dto.columnId) })
      .sort({ position: -1 })
      .lean();
    const position = (last?.position ?? 0) + 1000;

    return this.taskModel.create({
      ...dto,
      projectId: new Types.ObjectId(projectId),
      columnId: new Types.ObjectId(dto.columnId),
      parentTaskId: dto.parentTaskId ? new Types.ObjectId(dto.parentTaskId) : null,
      createdBy: new Types.ObjectId(createdBy),
      position,
    });
  }

  async findForProject(projectId: string, filters: TaskFilters) {
    const query: any = { projectId: new Types.ObjectId(projectId), parentTaskId: null };
    if (filters.columnId) query.columnId = new Types.ObjectId(filters.columnId);
    if (filters.assignee) query.assigneeIds = new Types.ObjectId(filters.assignee);
    if (filters.status) query.status = filters.status;
    return this.taskModel.find(query).sort({ position: 1 }).lean();
  }

  async move(taskId: string, dto: MoveTaskDto) {
    const existing = await this.taskModel.findById(taskId).lean();
    if (!existing) throw new NotFoundException('Task not found');

    const destinationColumn = await this.columnModel.findById(dto.columnId).lean();

    const patch: any = {
      columnId: new Types.ObjectId(dto.columnId),
      position: dto.position,
    };

    const movingIntoDone = destinationColumn?.name === 'Done';
    const wasInDone = existing.status === 'done';

    if (movingIntoDone && !wasInDone) {
      patch.status = 'done';
      patch.doneAt = new Date();
    } else if (!movingIntoDone && wasInDone) {
      patch.status = 'todo';
      patch.doneAt = null;
    }

    const task = await this.taskModel.findByIdAndUpdate(taskId, patch, { new: true });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(taskId: string, dto: UpdateTaskDto) {
    const existing = await this.taskModel.findById(taskId).lean();
    if (!existing) throw new NotFoundException('Task not found');

    const patch: any = { ...dto };

    if (dto.status && dto.status !== existing.status) {
      if (dto.status === 'done') {
        patch.doneAt = new Date();
      } else if (existing.status === 'done') {
        patch.doneAt = null;
      }
    }

    const task = await this.taskModel.findByIdAndUpdate(taskId, patch, { new: true });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async remove(taskId: string) {
    const res = await this.taskModel.findByIdAndDelete(taskId);
    if (!res) throw new NotFoundException('Task not found');
    return { deleted: true };
  }

  async findSubtasks(parentTaskId: string) {
    return this.taskModel
      .find({ parentTaskId: new Types.ObjectId(parentTaskId) })
      .sort({ position: 1 })
      .lean();
  }

  async getSubtaskProgress(parentTaskId: string) {
    const subtasks = await this.taskModel
      .find({ parentTaskId: new Types.ObjectId(parentTaskId) })
      .lean();
    const total = subtasks.length;
    const done = subtasks.filter((t) => t.status === 'done').length;
    return { total, done };
  }
}
