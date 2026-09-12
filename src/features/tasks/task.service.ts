import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from './schema/task.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';

interface TaskFilters {
  columnId?: string;
  assignee?: string;
  status?: string;
}

@Injectable()
export class TasksService {
  constructor(@InjectModel(Task.name) private taskModel: Model<TaskDocument>) {}

  async create(projectId: string, dto: CreateTaskDto, createdBy: string) {
    const last = await this.taskModel
      .findOne({ columnId: dto.columnId })
      .sort({ position: -1 })
      .lean();
    const position = (last?.position ?? 0) + 1000;
    return this.taskModel.create({ ...dto, projectId, createdBy, position });
  }

  async findForProject(projectId: string, filters: TaskFilters) {
    const query: any = { projectId };
    if (filters.columnId) query.columnId = filters.columnId;
    if (filters.assignee) query.assigneeIds = filters.assignee;
    if (filters.status) query.status = filters.status;
    return this.taskModel.find(query).sort({ position: 1 }).lean();
  }

  async update(taskId: string, dto: UpdateTaskDto) {
    const task = await this.taskModel.findByIdAndUpdate(taskId, dto, { new: true });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async move(taskId: string, dto: MoveTaskDto) {
    const task = await this.taskModel.findByIdAndUpdate(
      taskId,
      { columnId: dto.columnId, position: dto.position },
      { new: true },
    );
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async remove(taskId: string) {
    const res = await this.taskModel.findByIdAndDelete(taskId);
    if (!res) throw new NotFoundException('Task not found');
    return { deleted: true };
  }
}
