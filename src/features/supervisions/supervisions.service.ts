import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../users/schema/user.schema';
import { UserStatus } from '../../common/enums/user.status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { MailService } from '../mail/mail.service';
import { Supervision } from './schemas/supervision.schema';
import { Milestone } from './schemas/milestone.schema';
import { Meeting } from './schemas/meeting.schema';
import { ActionItem } from './schemas/action-item.schema';
import { InviteSupervisorDto } from './dto/supervision.dto';
import { SupervisionAccess } from './guards/supervision-access.guard';

const USER_FIELDS = 'username firstName lastName profilePhotoUrl';

export interface SupervisionStats {
  milestonesTotal: number;
  milestonesApproved: number;
  /** 0-100 */
  progress: number;
  overdueMilestones: number;
  openActionItems: number;
  overdueActionItems: number;
  overdueCount: number;
  nextMeeting: { _id: Types.ObjectId; scheduledAt: Date } | null;
  nextDueDate: Date | null;
}

@Injectable()
export class SupervisionsService {
  constructor(
    @InjectModel(Supervision.name) private supervisionModel: Model<Supervision>,
    @InjectModel(Milestone.name) private milestoneModel: Model<Milestone>,
    @InjectModel(Meeting.name) private meetingModel: Model<Meeting>,
    @InjectModel(ActionItem.name) private actionItemModel: Model<ActionItem>,
    @InjectModel(User.name) private userModel: Model<User>,
    private notifications: NotificationsService,
    private mail: MailService,
  ) {}

  // ---------------- INVITE / RESPOND ----------------

  async invite(studentId: string, dto: InviteSupervisorDto) {
    const student = await this.userModel.findById(studentId).select('firstName lastName').lean();
    if (!student) throw new NotFoundException('User not found.');
    const studentName = `${student.firstName} ${student.lastName}`.trim();

    let supervisorId: string | null = null;
    let inviteEmail: string | null = null;

    if (dto.supervisorId) {
      const exists = await this.userModel.exists({
        _id: dto.supervisorId,
        status: UserStatus.ACTIVE,
      });
      if (!exists) throw new NotFoundException('Supervisor not found.');
      supervisorId = dto.supervisorId;
    } else {
      const email = dto.email!.trim().toLowerCase();
      const found = await this.userModel.findOne({ email }).select('_id').lean();
      if (found) supervisorId = String(found._id);
      else inviteEmail = email;
    }

    if (supervisorId === studentId) {
      throw new BadRequestException('You cannot supervise yourself.');
    }

    const duplicate = await this.supervisionModel.exists({
      studentId,
      status: { $in: ['pending', 'active'] },
      ...(supervisorId ? { supervisorIds: supervisorId } : { inviteEmail }),
    });
    if (duplicate) {
      throw new ConflictException('You already have an open supervision with this supervisor.');
    }

    const supervision = await this.supervisionModel.create({
      studentId,
      supervisorIds: supervisorId ? [supervisorId] : [],
      inviteEmail,
      title: dto.title.trim(),
      status: 'pending',
    });

    if (supervisorId) {
      await this.notifications.create({
        recipientId: supervisorId,
        actorId: studentId,
        type: NotificationType.SUPERVISION_INVITE,
        message: `${studentName} invited you to supervise "${supervision.title}"`,
        entityType: 'supervision',
        entityId: supervision._id as Types.ObjectId,
        data: { title: supervision.title },
      });
    } else if (inviteEmail) {
      await this.mail.sendSupervisionInviteEmail(inviteEmail, studentName, supervision.title);
    }

    return supervision.toObject();
  }

  async respond(userId: string, id: string, accept: boolean) {
    const supervision = await this.findOrFail(id);
    const isInvited = supervision.supervisorIds.some((s) => String(s) === userId);
    if (!isInvited) throw new NotFoundException('Supervision not found.');
    if (supervision.status !== 'pending') {
      throw new ConflictException('This invitation has already been answered.');
    }

    supervision.status = accept ? 'active' : 'declined';
    if (accept) supervision.startedAt = new Date();
    await supervision.save();

    const me = await this.userModel.findById(userId).select('firstName lastName').lean();
    const name = me ? `${me.firstName} ${me.lastName}`.trim() : 'Your supervisor';
    await this.notifications.create({
      recipientId: supervision.studentId,
      actorId: userId,
      type: NotificationType.SUPERVISION_RESPONDED,
      message: `${name} ${accept ? 'accepted' : 'declined'} your supervision request "${supervision.title}"`,
      entityType: 'supervision',
      entityId: supervision._id as Types.ObjectId,
      data: { accepted: accept },
    });

    return supervision.toObject();
  }

  /**
   * Links email invites to a user who has signed up since. Cheap and idempotent, so it
   * runs whenever a supervisor opens their dashboard instead of hooking into signup.
   */
  private async claimEmailInvites(userId: string) {
    const me = await this.userModel.findById(userId).select('email').lean();
    if (!me?.email) return;

    const pending = await this.supervisionModel
      .find({ inviteEmail: me.email.toLowerCase(), status: 'pending', supervisorIds: { $size: 0 } })
      .populate('studentId', 'firstName lastName')
      .exec();

    for (const s of pending) {
      // conditional update: two parallel requests can't both claim it
      const claimed = await this.supervisionModel.findOneAndUpdate(
        { _id: s._id, supervisorIds: { $size: 0 } },
        { $set: { supervisorIds: [userId], inviteEmail: null } },
      );
      if (!claimed) continue;
      const student = s.studentId as unknown as User;
      await this.notifications.create({
        recipientId: userId,
        actorId: student._id as Types.ObjectId,
        type: NotificationType.SUPERVISION_INVITE,
        message: `${student.firstName} ${student.lastName} invited you to supervise "${s.title}"`,
        entityType: 'supervision',
        entityId: s._id as Types.ObjectId,
        data: { title: s.title },
      });
    }
  }

  // ---------------- DASHBOARDS ----------------

  /** Student view: my own supervisions, newest first. */
  async mine(userId: string) {
    const list = await this.supervisionModel
      .find({ studentId: userId })
      .sort({ createdAt: -1 })
      .populate('supervisorIds', USER_FIELDS)
      .lean();

    const stats = await this.statsFor(
      list.filter((s) => s.status === 'active' || s.status === 'ended').map((s) => s._id),
    );
    return list.map((s) => ({ ...s, stats: stats.get(String(s._id)) ?? null }));
  }

  /**
   * Supervisor view: students I supervise, plus invitations waiting for my answer.
   * Pending rows carry no stats: the supervisor has not accepted yet.
   */
  async students(userId: string) {
    await this.claimEmailInvites(userId);

    const list = await this.supervisionModel
      .find({ supervisorIds: userId, status: { $in: ['pending', 'active'] } })
      .sort({ createdAt: -1 })
      .populate('studentId', USER_FIELDS)
      .lean();

    const stats = await this.statsFor(list.filter((s) => s.status === 'active').map((s) => s._id));
    return list.map((s) => ({
      ...s,
      supervisorRole: String(s.supervisorIds[0]) === userId ? 'primary' : 'co-supervisor',
      stats: stats.get(String(s._id)) ?? null,
    }));
  }

  /** Everything the supervision home page needs in one call. */
  async overview(access: SupervisionAccess) {
    const id = access.supervision._id as Types.ObjectId;
    const now = new Date();
    const [supervision, milestones, nextMeeting, openActionItems, stats] = await Promise.all([
      this.supervisionModel
        .findById(id)
        .populate('studentId', USER_FIELDS)
        .populate('supervisorIds', USER_FIELDS)
        .lean(),
      this.milestoneModel.find({ supervisionId: id }).sort({ order: 1, dueDate: 1 }).lean(),
      this.meetingModel
        .findOne({ supervisionId: id, status: 'planned', scheduledAt: { $gte: now } })
        .sort({ scheduledAt: 1 })
        .lean(),
      this.actionItemModel
        .find({ supervisionId: id, status: 'open' })
        .sort({ dueDate: 1 })
        .populate('assigneeId', USER_FIELDS)
        .lean(),
      this.statsFor([id]),
    ]);

    return {
      supervision,
      role: access.role,
      milestones,
      nextMeeting,
      openActionItems,
      stats: stats.get(String(id)) ?? null,
    };
  }

  // ---------------- END / EXPORT ----------------

  /** Changing supervisor = end this one and invite another; the history stays readable. */
  async end(access: SupervisionAccess) {
    const { supervision, userId } = access;
    if (supervision.status !== 'active' && supervision.status !== 'pending') {
      throw new ConflictException('This supervision is already closed.');
    }
    supervision.status = 'ended';
    supervision.endedAt = new Date();
    await supervision.save();

    const others = [supervision.studentId, ...supervision.supervisorIds].filter(
      (u) => String(u) !== userId,
    );
    await Promise.all(
      others.map((recipientId) =>
        this.notifications.create({
          recipientId,
          actorId: userId,
          type: NotificationType.SUPERVISION_ENDED,
          message: `The supervision "${supervision.title}" has ended`,
          entityType: 'supervision',
          entityId: supervision._id as Types.ObjectId,
        }),
      ),
    );
    return supervision.toObject();
  }

  /** Plain-data summary the student can save before moving on. */
  async exportSummary(access: SupervisionAccess) {
    const id = access.supervision._id;
    const [supervision, milestones, meetings, actionItems] = await Promise.all([
      this.supervisionModel
        .findById(id)
        .populate('studentId', 'firstName lastName')
        .populate('supervisorIds', 'firstName lastName')
        .lean(),
      this.milestoneModel.find({ supervisionId: id }).sort({ order: 1 }).lean(),
      this.meetingModel.find({ supervisionId: id }).sort({ scheduledAt: 1 }).lean(),
      this.actionItemModel
        .find({ supervisionId: id })
        .sort({ dueDate: 1 })
        .populate('assigneeId', 'firstName lastName')
        .lean(),
    ]);
    return { exportedAt: new Date(), supervision, milestones, meetings, actionItems };
  }

  // ---------------- helpers ----------------

  private async findOrFail(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Supervision not found.');
    const s = await this.supervisionModel.findById(id);
    if (!s) throw new NotFoundException('Supervision not found.');
    return s;
  }

  /** Progress, overdue counts and next meeting for many supervisions in three queries. */
  private async statsFor(ids: Types.ObjectId[]): Promise<Map<string, SupervisionStats>> {
    const out = new Map<string, SupervisionStats>();
    if (!ids.length) return out;
    const now = new Date();

    const notApproved = { $ne: ['$status', 'approved'] };
    const hasDue = { $ne: ['$dueDate', null] };

    const [ms, ai, meetings] = await Promise.all([
      this.milestoneModel.aggregate<{
        _id: Types.ObjectId;
        total: number;
        approved: number;
        overdue: number;
        nextDue: Date | null;
      }>([
        { $match: { supervisionId: { $in: ids } } },
        {
          $group: {
            _id: '$supervisionId',
            total: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
            overdue: {
              $sum: {
                $cond: [{ $and: [notApproved, hasDue, { $lt: ['$dueDate', now] }] }, 1, 0],
              },
            },
            nextDue: {
              $min: {
                $cond: [{ $and: [notApproved, hasDue, { $gte: ['$dueDate', now] }] }, '$dueDate', null],
              },
            },
          },
        },
      ]),
      this.actionItemModel.aggregate<{ _id: Types.ObjectId; open: number; overdue: number }>([
        { $match: { supervisionId: { $in: ids }, status: 'open' } },
        {
          $group: {
            _id: '$supervisionId',
            open: { $sum: 1 },
            overdue: { $sum: { $cond: [{ $and: [hasDue, { $lt: ['$dueDate', now] }] }, 1, 0] } },
          },
        },
      ]),
      this.meetingModel.aggregate<{ _id: Types.ObjectId; meetingId: Types.ObjectId; at: Date }>([
        { $match: { supervisionId: { $in: ids }, status: 'planned', scheduledAt: { $gte: now } } },
        { $sort: { scheduledAt: 1 } },
        {
          $group: {
            _id: '$supervisionId',
            meetingId: { $first: '$_id' },
            at: { $first: '$scheduledAt' },
          },
        },
      ]),
    ]);

    const msBy = new Map(ms.map((r) => [String(r._id), r]));
    const aiBy = new Map(ai.map((r) => [String(r._id), r]));
    const meetBy = new Map(meetings.map((r) => [String(r._id), r]));

    for (const id of ids) {
      const key = String(id);
      const m = msBy.get(key);
      const a = aiBy.get(key);
      const mt = meetBy.get(key);
      const total = m?.total ?? 0;
      const overdueMilestones = m?.overdue ?? 0;
      const overdueActionItems = a?.overdue ?? 0;
      out.set(key, {
        milestonesTotal: total,
        milestonesApproved: m?.approved ?? 0,
        progress: total ? Math.round(((m?.approved ?? 0) / total) * 100) : 0,
        overdueMilestones,
        openActionItems: a?.open ?? 0,
        overdueActionItems,
        overdueCount: overdueMilestones + overdueActionItems,
        nextMeeting: mt ? { _id: mt.meetingId, scheduledAt: mt.at } : null,
        nextDueDate: m?.nextDue ?? null,
      });
    }
    return out;
  }
}
