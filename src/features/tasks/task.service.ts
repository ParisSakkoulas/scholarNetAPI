import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument } from './schema/task.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { Column, ColumnDocument } from '../projects/schema/column.schema';
import { Project, ProjectDocument } from '../projects/schema/project.schema';
import { TeamMember, TeamMemberDocument } from '../teams/schema/team-member.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';

interface TaskFilters {
  columnId?: string;
  assignee?: string;
  status?: string;
}

/** The requester's standing in the team that owns a task's project. */
interface Access {
  role: string;
  canManage: boolean;
  teamId: Types.ObjectId;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Column.name) private columnModel: Model<ColumnDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(TeamMember.name) private memberModel: Model<TeamMemberDocument>,
    private notificationsService: NotificationsService,
  ) {}

  // ---------------- access ----------------

  /** Active membership of the project's team; admins and owners can manage. */
  private async accessForProject(projectId: string, userId: string): Promise<Access> {
    const project = await this.projectModel.findById(projectId).select('teamId').lean();
    if (!project) throw new NotFoundException('Project not found');

    const member = await this.memberModel
      .findOne({ teamId: project.teamId, userId: new Types.ObjectId(userId), status: 'active' })
      .lean();
    if (!member) throw new ForbiddenException('You are not a member of this team');

    return {
      role: member.role,
      canManage: member.role === 'owner' || member.role === 'admin',
      teamId: project.teamId,
    };
  }

  private assertCanWrite(access: Access) {
    if (access.role === 'viewer') throw new ForbiddenException('Viewers cannot change tasks');
  }

  /** Once an admin/owner has approved a task, only admins and owners may touch it. */
  private assertNotLocked(access: Access, task: { approvedAt?: Date | null }) {
    if (task.approvedAt && !access.canManage) {
      throw new ForbiddenException('This task is approved and can only be changed by admins and owners');
    }
  }

  private assertCanManage(access: Access, message: string) {
    if (!access.canManage) throw new ForbiddenException(message);
  }

  /** Managers can set any status; everyone else only on tasks assigned to them. */
  private assertCanChangeStatus(
    access: Access,
    task: { assigneeIds?: Types.ObjectId[] },
    userId: string,
  ) {
    const isAssignee = (task.assigneeIds ?? []).some((id) => id.toString() === userId.toString());
    if (access.canManage || isAssignee) return;
    throw new ForbiddenException(
      'Only the assignee, admins and owners can change the status of a task',
    );
  }

  /** Assignees must belong to the team — otherwise anyone's id could be put on a task. */
  private async assertAssigneesInTeam(teamId: Types.ObjectId, assigneeIds: string[]) {
    const unique = [...new Set(assigneeIds)];
    if (!unique.length) return;
    const count = await this.memberModel.countDocuments({
      teamId,
      userId: { $in: unique.map((id) => new Types.ObjectId(id)) },
      status: 'active',
    });
    if (count !== unique.length) {
      throw new BadRequestException('Tasks can only be assigned to active team members');
    }
  }

  private async notifyAssigned(
    task: { _id: unknown; title: string; projectId: unknown },
    assigneeIds: string[],
    actorId: string,
  ) {
    await Promise.all(
      assigneeIds.map((recipientId) =>
        this.notificationsService.create({
          recipientId,
          actorId,
          type: NotificationType.TASK_ASSIGNED,
          message: `You were assigned to "${task.title}"`,
          entityType: 'task',
          entityId: String(task._id),
          data: { projectId: String(task.projectId) },
        }),
      ),
    );
  }

  // ---------------- crud ----------------

  async create(projectId: string, dto: CreateTaskDto, createdBy: string) {
    const access = await this.accessForProject(projectId, createdBy);
    this.assertCanWrite(access);

    if (dto.parentTaskId) {
      const parent = await this.taskModel.findById(dto.parentTaskId).select('approvedAt').lean();
      if (parent) this.assertNotLocked(access, parent);
    }

    const assigneeIds = [...new Set(dto.assigneeIds ?? [])];
    if (assigneeIds.length) {
      this.assertCanManage(access, 'Only admins and owners can assign tasks');
      await this.assertAssigneesInTeam(access.teamId, assigneeIds);
    }

    const last = await this.taskModel
      .findOne({ columnId: new Types.ObjectId(dto.columnId) })
      .sort({ position: -1 })
      .lean();
    const position = (last?.position ?? 0) + 1000;

    const task = await this.taskModel.create({
      ...dto,
      assigneeIds: assigneeIds.map((id) => new Types.ObjectId(id)),
      projectId: new Types.ObjectId(projectId),
      columnId: new Types.ObjectId(dto.columnId),
      parentTaskId: dto.parentTaskId ? new Types.ObjectId(dto.parentTaskId) : null,
      createdBy: new Types.ObjectId(createdBy),
      position,
    });

    await this.notifyAssigned(task, assigneeIds, createdBy);
    return task;
  }

  async findForProject(projectId: string, filters: TaskFilters, userId: string) {
    await this.accessForProject(projectId, userId);

    const query: any = { projectId: new Types.ObjectId(projectId), parentTaskId: null };
    if (filters.columnId) query.columnId = new Types.ObjectId(filters.columnId);
    if (filters.assignee) query.assigneeIds = new Types.ObjectId(filters.assignee);
    if (filters.status) query.status = filters.status;
    return this.taskModel.find(query).sort({ position: 1 }).lean();
  }

  async move(taskId: string, dto: MoveTaskDto, userId: string) {
    const existing = await this.taskModel.findById(taskId).lean();
    if (!existing) throw new NotFoundException('Task not found');
    const access = await this.accessForProject(existing.projectId.toString(), userId);
    this.assertCanWrite(access);
    this.assertNotLocked(access, existing);

    const destinationColumn = await this.columnModel.findById(dto.columnId).lean();

    const patch: any = {
      columnId: new Types.ObjectId(dto.columnId),
      position: dto.position,
    };

    const movingIntoDone = destinationColumn?.name === 'Done';
    const wasInDone = existing.status === 'done';

    if (movingIntoDone && !wasInDone) {
      this.assertCanChangeStatus(access, existing, userId);
      patch.status = 'done';
      patch.doneAt = new Date();
    } else if (!movingIntoDone && wasInDone) {
      this.assertCanChangeStatus(access, existing, userId);
      patch.status = 'todo';
      patch.doneAt = null;
      // reopening a task voids the sign-off
      patch.approvedBy = null;
      patch.approvedAt = null;
    }

    const task = await this.taskModel.findByIdAndUpdate(taskId, patch, { new: true });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(taskId: string, dto: UpdateTaskDto, userId: string) {
    const existing = await this.taskModel.findById(taskId).lean();
    if (!existing) throw new NotFoundException('Task not found');
    const access = await this.accessForProject(existing.projectId.toString(), userId);
    this.assertCanWrite(access);
    this.assertNotLocked(access, existing);

    const patch: any = { ...dto };

    // assignment is a management decision
    let newlyAssigned: string[] = [];
    if (dto.assigneeIds) {
      const before = new Set((existing.assigneeIds ?? []).map((id) => id.toString()));
      const next = [...new Set(dto.assigneeIds)];
      const changed = next.length !== before.size || next.some((id) => !before.has(id));
      if (changed) {
        this.assertCanManage(access, 'Only admins and owners can assign tasks');
        await this.assertAssigneesInTeam(access.teamId, next);
        newlyAssigned = next.filter((id) => !before.has(id));
      }
      patch.assigneeIds = next.map((id) => new Types.ObjectId(id));
    }

    if (dto.status && dto.status !== existing.status) {
      this.assertCanChangeStatus(access, existing, userId);
      if (dto.status === 'done') {
        patch.doneAt = new Date();
      } else if (existing.status === 'done') {
        patch.doneAt = null;
        patch.approvedBy = null;
        patch.approvedAt = null;
      }
    }

    const task = await this.taskModel.findByIdAndUpdate(taskId, patch, { new: true });
    if (!task) throw new NotFoundException('Task not found');

    await this.notifyAssigned(task, newlyAssigned, userId);
    return task;
  }

  // ---------------- approval ----------------

  async approve(taskId: string, userId: string) {
    const existing = await this.taskModel.findById(taskId).lean();
    if (!existing) throw new NotFoundException('Task not found');
    const access = await this.accessForProject(existing.projectId.toString(), userId);
    this.assertCanManage(access, 'Only admins and owners can approve tasks');

    if (existing.status !== 'done') {
      throw new BadRequestException('Only completed tasks can be approved');
    }

    const task = await this.taskModel.findByIdAndUpdate(
      taskId,
      { approvedBy: new Types.ObjectId(userId), approvedAt: new Date() },
      { new: true },
    );
    if (!task) throw new NotFoundException('Task not found');

    await Promise.all(
      (task.assigneeIds ?? []).map((assignee) =>
        this.notificationsService.create({
          recipientId: assignee.toString(),
          actorId: userId,
          type: NotificationType.TASK_APPROVED,
          message: `"${task.title}" was approved`,
          entityType: 'task',
          entityId: String(task._id),
          data: { projectId: String(task.projectId) },
        }),
      ),
    );
    return task;
  }

  async unapprove(taskId: string, userId: string) {
    const existing = await this.taskModel.findById(taskId).lean();
    if (!existing) throw new NotFoundException('Task not found');
    const access = await this.accessForProject(existing.projectId.toString(), userId);
    this.assertCanManage(access, 'Only admins and owners can change approvals');

    const task = await this.taskModel.findByIdAndUpdate(
      taskId,
      { approvedBy: null, approvedAt: null },
      { new: true },
    );
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  // ---------------- delete / subtasks ----------------

  async remove(taskId: string, userId: string) {
    const existing = await this.taskModel.findById(taskId).lean();
    if (!existing) throw new NotFoundException('Task not found');
    const access = await this.accessForProject(existing.projectId.toString(), userId);
    this.assertCanWrite(access);
    this.assertNotLocked(access, existing);
    if (!access.canManage && existing.createdBy.toString() !== userId.toString()) {
      throw new ForbiddenException('Only admins, owners or the task creator can delete a task');
    }

    await this.taskModel.findByIdAndDelete(taskId);
    return { deleted: true };
  }

  async findSubtasks(parentTaskId: string, userId: string) {
    const parent = await this.taskModel.findById(parentTaskId).select('projectId').lean();
    if (!parent) throw new NotFoundException('Task not found');
    await this.accessForProject(parent.projectId.toString(), userId);

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
