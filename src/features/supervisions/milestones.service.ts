import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Milestone } from './schemas/milestone.schema';
import { ApplyTemplateDto, CreateMilestoneDto, UpdateMilestoneDto } from './dto/milestone.dto';
import { SupervisionAccess } from './guards/supervision-access.guard';
import { MILESTONE_TEMPLATES } from './milestone-templates';

/** Statuses that are a supervisor's verdict; the student can only move work forward. */
const SUPERVISOR_ONLY = ['approved', 'needs_changes'];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class MilestonesService {
  constructor(@InjectModel(Milestone.name) private milestoneModel: Model<Milestone>) {}

  list(access: SupervisionAccess) {
    return this.milestoneModel
      .find({ supervisionId: access.supervision._id })
      .sort({ order: 1, dueDate: 1 })
      .lean();
  }

  async create(access: SupervisionAccess, dto: CreateMilestoneDto) {
    const supervisionId = access.supervision._id;
    let order = dto.order;
    if (order === undefined) {
      const last = await this.milestoneModel
        .findOne({ supervisionId })
        .sort({ order: -1 })
        .select('order')
        .lean();
      order = last ? last.order + 1 : 0;
    }
    return this.milestoneModel.create({ ...dto, supervisionId, order });
  }

  async applyTemplate(access: SupervisionAccess, dto: ApplyTemplateDto) {
    const supervisionId = access.supervision._id;
    if (await this.milestoneModel.exists({ supervisionId })) {
      throw new ConflictException('This supervision already has milestones.');
    }
    const steps = MILESTONE_TEMPLATES[dto.template ?? 'thesis'];
    const start = (dto.startDate ?? new Date()).getTime();
    await this.milestoneModel.insertMany(
      steps.map((step, order) => ({
        supervisionId,
        title: step.title,
        description: step.description,
        order,
        dueDate: new Date(start + step.weeks * WEEK_MS),
      })),
    );
    return this.list(access);
  }

  async update(access: SupervisionAccess, id: string, dto: UpdateMilestoneDto) {
    const milestone = await this.findOrFail(access, id);
    const isSupervisor = access.role === 'supervisor';

    if (dto.status && SUPERVISOR_ONLY.includes(dto.status) && !isSupervisor) {
      throw new ForbiddenException('Only a supervisor can approve a milestone or request changes.');
    }
    if (milestone.status === 'approved' && !isSupervisor) {
      throw new ForbiddenException('An approved milestone can only be changed by a supervisor.');
    }

    if (dto.title !== undefined) milestone.title = dto.title;
    if (dto.description !== undefined) milestone.description = dto.description;
    if (dto.order !== undefined) milestone.order = dto.order;
    if (dto.dueDate !== undefined) {
      milestone.dueDate = dto.dueDate;
      // a moved deadline deserves fresh reminders
      milestone.dueSoonNotifiedAt = null;
      milestone.overdueNotifiedAt = null;
    }
    if (dto.status !== undefined && dto.status !== milestone.status) {
      milestone.status = dto.status;
      milestone.completedAt = dto.status === 'approved' ? new Date() : null;
    }
    return milestone.save();
  }

  async remove(access: SupervisionAccess, id: string) {
    const milestone = await this.findOrFail(access, id);
    if (milestone.status === 'approved' && access.role !== 'supervisor') {
      throw new ForbiddenException('An approved milestone can only be removed by a supervisor.');
    }
    await milestone.deleteOne();
    return { deleted: true };
  }

  private async findOrFail(access: SupervisionAccess, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Milestone not found.');
    const m = await this.milestoneModel.findOne({ _id: id, supervisionId: access.supervision._id });
    if (!m) throw new NotFoundException('Milestone not found.');
    return m;
  }
}
