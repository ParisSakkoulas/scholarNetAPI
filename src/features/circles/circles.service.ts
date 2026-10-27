import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Page } from '../../common/models/pagination-types';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { User } from '../users/schema/user.schema';
import { Circle, DEFAULT_MAX_MEMBERS } from './schemas/circle.schema';
import { CircleMember } from './schemas/circle-member.schema';
import { CircleSession } from './schemas/circle-session.schema';
import { CircleReport } from './schemas/circle-report.schema';
import {
  CreateCircleDto,
  ListCirclesQuery,
  ReportCircleDto,
  UpdateCircleDto,
  UpdateMemberDto,
} from './dto/circle.dto';
import { CircleSessionsService } from './circle-sessions.service';
import { nextOccurrence, sessionEnd } from './util/schedule.util';

const OWNER_FIELDS = 'username firstName lastName profilePhotoUrl';
/** A paused member still holds a seat. */
const SEAT_STATUSES = ['active', 'paused'];

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Circle not found');
  return new Types.ObjectId(id);
};

@Injectable()
export class CirclesService {
  constructor(
    @InjectModel(Circle.name) private circleModel: Model<Circle>,
    @InjectModel(CircleMember.name) private memberModel: Model<CircleMember>,
    @InjectModel(CircleSession.name) private sessionModel: Model<CircleSession>,
    @InjectModel(CircleReport.name) private reportModel: Model<CircleReport>,
    @InjectModel(User.name) private userModel: Model<User>,
    private sessions: CircleSessionsService,
    private notifications: NotificationsService,
  ) {}

  // ---------------- helpers ----------------

  private async getCircle(id: string) {
    const circle = await this.circleModel.findById(oid(id));
    if (!circle) throw new NotFoundException('Circle not found');
    return circle;
  }

  private seatsTaken(circleId: Types.ObjectId) {
    return this.memberModel.countDocuments({ circleId, status: { $in: SEAT_STATUSES } });
  }

  private assertOwner(circle: Circle, userId: string) {
    if (circle.ownerId.toString() !== userId) {
      throw new ForbiddenException('Only the owner of the circle can do this');
    }
  }

  private async displayName(userId: string) {
    const u = await this.userModel.findById(userId).select('firstName lastName username').lean();
    return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || u?.username || 'Someone';
  }

  /** Tells the owner and every current member that someone new is in. The newcomer is skipped. */
  private async notifyJoined(circle: Circle, newcomerId: string) {
    const [name, members] = await Promise.all([
      this.displayName(newcomerId),
      this.memberModel
        .find({ circleId: circle._id, status: { $in: SEAT_STATUSES }, userId: { $ne: new Types.ObjectId(newcomerId) } })
        .select('userId')
        .lean(),
    ]);
    await Promise.all(
      members.map((m) =>
        this.notifications.create({
          recipientId: m.userId,
          actorId: newcomerId,
          type: NotificationType.CIRCLE_MEMBER_JOINED,
          message: `${name} joined "${circle.name}"`,
          entityType: 'circle',
          entityId: circle._id,
        }),
      ),
    );
  }

  // ---------------- circles ----------------

  async create(userId: string, dto: CreateCircleDto) {
    const circle = await this.circleModel.create({
      ...dto,
      maxMembers: dto.maxMembers ?? DEFAULT_MAX_MEMBERS,
      ownerId: new Types.ObjectId(userId),
    });
    await this.memberModel.create({
      circleId: circle._id,
      userId: new Types.ObjectId(userId),
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    });
    await this.sessions.generate(circle);
    return circle;
  }

  /** Browse: open circles, filterable. Includes the caller's own membership status per circle. */
  async list(userId: string, query: ListCirclesQuery): Promise<Page<unknown>> {
    const filter: Record<string, unknown> = { status: 'active' };
    if (query.field?.trim()) filter.field = { $regex: escapeRegex(query.field.trim()), $options: 'i' };
    if (query.stage) filter.stage = query.stage;
    if (query.visibility) filter.visibility = query.visibility;
    if (query.timezone) filter['schedule.timezone'] = query.timezone;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;

    const [circles, total] = await Promise.all([
      this.circleModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate('ownerId', OWNER_FIELDS)
        .select('-meetingUrl') // the link is for members only
        .lean(),
      this.circleModel.countDocuments(filter),
    ]);

    const ids = circles.map((c) => c._id);
    const [counts, mine] = await Promise.all([
      this.memberModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { circleId: { $in: ids }, status: { $in: SEAT_STATUSES } } },
        { $group: { _id: '$circleId', n: { $sum: 1 } } },
      ]),
      this.memberModel
        .find({ circleId: { $in: ids }, userId: new Types.ObjectId(userId) })
        .select('circleId status role')
        .lean(),
    ]);
    const countById = new Map(counts.map((c) => [c._id.toString(), c.n]));
    const mineById = new Map(mine.map((m) => [m.circleId.toString(), m]));

    return {
      total,
      data: circles.map((c) => ({
        ...c,
        memberCount: countById.get(c._id.toString()) ?? 0,
        myStatus: mineById.get(c._id.toString())?.status ?? null,
        nextSessionAt: nextOccurrence(c.schedule),
      })),
    };
  }

  /** The caller's circles, each with its next session. */
  async mine(userId: string) {
    const memberships = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: { $in: ['pending', 'active', 'paused'] } })
      .lean();
    const circles = await this.circleModel
      .find({ _id: { $in: memberships.map((m) => m.circleId) }, status: { $ne: 'closed' } })
      .populate('ownerId', OWNER_FIELDS)
      .lean();

    // 240 min is the longest allowed session, so this window includes one that is running right now
    const upcoming = await this.sessionModel
      .find({
        circleId: { $in: circles.map((c) => c._id) },
        status: 'planned',
        startsAt: { $gte: new Date(Date.now() - 240 * 60 * 1000) },
      })
      .sort({ startsAt: 1 })
      .select('-entries')
      .lean();

    const now = Date.now();
    const nextById = new Map<string, (typeof upcoming)[number]>();
    for (const s of upcoming) {
      const key = s.circleId.toString();
      if (!nextById.has(key) && sessionEnd(s.startsAt, s.durationMin).getTime() >= now) {
        nextById.set(key, s);
      }
    }

    const statusById = new Map(memberships.map((m) => [m.circleId.toString(), m]));
    return circles
      .map((c) => ({
        circle: c,
        myStatus: statusById.get(c._id.toString())?.status,
        streak: statusById.get(c._id.toString())?.streak ?? 0,
        nextSession: nextById.get(c._id.toString()) ?? null,
      }))
      .sort(
        (a, b) =>
          (a.nextSession?.startsAt.getTime() ?? Infinity) -
          (b.nextSession?.startsAt.getTime() ?? Infinity),
      );
  }

  async findOne(id: string, userId: string) {
    const circleId = oid(id);
    const circle = await this.circleModel
      .findById(circleId)
      .populate('ownerId', OWNER_FIELDS)
      .lean();
    if (!circle) throw new NotFoundException('Circle not found');

    const mine = await this.memberModel
      .findOne({ circleId, userId: new Types.ObjectId(userId) })
      .lean();
    const isMember = !!mine && SEAT_STATUSES.includes(mine.status);
    const isOwner = (circle.ownerId as any)._id.toString() === userId;

    const memberCount = await this.seatsTaken(circleId);
    // members, goals and the meeting link are for members only
    const members = isMember
      ? await this.memberModel
          .find({ circleId, status: { $in: isOwner ? ['pending', ...SEAT_STATUSES] : SEAT_STATUSES } })
          .populate('userId', OWNER_FIELDS)
          .lean()
      : undefined;

    return {
      ...circle,
      meetingUrl: isMember ? circle.meetingUrl : undefined,
      memberCount,
      myStatus: mine?.status ?? null,
      myRole: mine?.role ?? null,
      nextSessionAt: nextOccurrence(circle.schedule),
      members,
    };
  }

  async update(id: string, userId: string, dto: UpdateCircleDto) {
    const circle = await this.getCircle(id);
    this.assertOwner(circle, userId);
    if (circle.status === 'closed') throw new BadRequestException('This circle is closed');

    if (dto.maxMembers !== undefined && dto.maxMembers < (await this.seatsTaken(circle._id))) {
      throw new BadRequestException('maxMembers cannot be lower than the current number of members');
    }

    const current = circle.schedule;
    const scheduleChanged =
      !!dto.schedule &&
      (dto.schedule.weekday !== current.weekday ||
        dto.schedule.time !== current.time ||
        dto.schedule.durationMin !== current.durationMin ||
        dto.schedule.timezone !== current.timezone);

    circle.set(dto);
    await circle.save();
    if (scheduleChanged) await this.sessions.reschedule(circle);
    return circle;
  }

  /** "Delete" closes the circle and cancels its future sessions; history is kept. */
  async close(id: string, userId: string) {
    const circle = await this.getCircle(id);
    this.assertOwner(circle, userId);
    circle.status = 'closed';
    await circle.save();
    await this.sessions.cancelFuture(circle._id);
    return { closed: true };
  }

  // ---------------- membership ----------------

  async join(id: string, userId: string) {
    const circle = await this.getCircle(id);
    if (circle.status !== 'active') throw new BadRequestException('This circle is not accepting members');

    const uid = new Types.ObjectId(userId);
    const existing = await this.memberModel.findOne({ circleId: circle._id, userId: uid });
    if (existing?.status === 'removed') {
      throw new ForbiddenException('You were removed from this circle by its owner');
    }
    if (existing?.status === 'pending') throw new ConflictException('Your request is already pending');
    if (existing && SEAT_STATUSES.includes(existing.status)) {
      throw new ConflictException('You are already in this circle');
    }

    const invite = circle.visibility === 'invite';
    if (!invite && (await this.seatsTaken(circle._id)) >= circle.maxMembers) {
      throw new ConflictException('This circle is full');
    }

    const member = await this.memberModel.findOneAndUpdate(
      { circleId: circle._id, userId: uid },
      {
        $set: {
          role: 'member',
          status: invite ? 'pending' : 'active',
          missedInRow: 0,
          joinedAt: invite ? null : new Date(),
        },
        $setOnInsert: { streak: 0, totalSessions: 0 },
      },
      { upsert: true, new: true },
    );

    // two people taking the last seat at once: the one who lands second backs out
    if (!invite && (await this.seatsTaken(circle._id)) > circle.maxMembers) {
      await this.memberModel.updateOne({ _id: member._id }, { status: 'left' });
      throw new ConflictException('This circle is full');
    }

    if (!invite) await this.notifyJoined(circle, userId);

    if (invite) {
      await this.notifications.create({
        recipientId: circle.ownerId,
        actorId: userId,
        type: NotificationType.CIRCLE_JOIN_REQUEST,
        message: `${await this.displayName(userId)} asked to join "${circle.name}"`,
        entityType: 'circle',
        entityId: circle._id,
      });
    }
    return member;
  }

  async leave(id: string, userId: string) {
    const circle = await this.getCircle(id);
    if (circle.ownerId.toString() === userId) {
      throw new BadRequestException('The owner cannot leave the circle; close it instead');
    }
    const member = await this.memberModel.findOneAndUpdate(
      { circleId: circle._id, userId: new Types.ObjectId(userId), status: { $in: ['pending', ...SEAT_STATUSES] } },
      { status: 'left' },
      { new: true },
    );
    if (!member) throw new NotFoundException('You are not in this circle');
    return { left: true };
  }

  async updateMember(id: string, ownerId: string, targetUserId: string, dto: UpdateMemberDto) {
    const circle = await this.getCircle(id);
    this.assertOwner(circle, ownerId);
    if (!Types.ObjectId.isValid(targetUserId)) throw new NotFoundException('Member not found');
    const target = await this.memberModel.findOne({
      circleId: circle._id,
      userId: new Types.ObjectId(targetUserId),
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') throw new BadRequestException('The owner cannot be changed');

    if (dto.action === 'approve') {
      if (target.status !== 'pending') throw new BadRequestException('There is no pending request to approve');
      if ((await this.seatsTaken(circle._id)) >= circle.maxMembers) {
        throw new ConflictException('This circle is full');
      }
      target.status = 'active';
      target.joinedAt = new Date();
      await target.save();
      await this.notifications.create({
        recipientId: target.userId,
        actorId: ownerId,
        type: NotificationType.CIRCLE_JOIN_APPROVED,
        message: `You were accepted into "${circle.name}"`,
        entityType: 'circle',
        entityId: circle._id,
      });
      // the owner who approved is skipped (they are the actor); everyone else hears about it
      await this.notifyJoined(circle, target.userId.toString());
      return target;
    }

    if (!['pending', ...SEAT_STATUSES].includes(target.status)) {
      throw new BadRequestException('This person is not in the circle');
    }
    target.status = 'removed';
    await target.save();
    return target;
  }

  // ---------------- moderation ----------------

  async report(id: string, userId: string, dto: ReportCircleDto) {
    const circle = await this.getCircle(id);
    if (circle.ownerId.toString() === userId) throw new BadRequestException('You cannot report your own circle');
    try {
      await this.reportModel.create({
        circleId: circle._id,
        reporterId: new Types.ObjectId(userId),
        reason: dto.reason,
      });
    } catch (err: any) {
      if (err?.code === 11000) throw new ConflictException('You already reported this circle');
      throw err;
    }
    return { reported: true };
  }
}
