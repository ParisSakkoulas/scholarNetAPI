import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Circle } from './schemas/circle.schema';
import { CircleMember } from './schemas/circle-member.schema';
import { CircleSession } from './schemas/circle-session.schema';
import { CheckoutDto, GoalDto, UpdateSessionDto } from './dto/circle.dto';
import {
  isCheckoutWindowOpen,
  isGoalWindowOpen,
  occurrences,
  sessionEnd,
} from './util/schedule.util';

/** Sessions are generated this far ahead. */
export const GENERATE_AHEAD_DAYS = 28;
const PAST_DAYS_SHOWN = 30;

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
  return new Types.ObjectId(id);
};

@Injectable()
export class CircleSessionsService {
  private readonly logger = new Logger(CircleSessionsService.name);

  constructor(
    @InjectModel(Circle.name) private circleModel: Model<Circle>,
    @InjectModel(CircleMember.name) private memberModel: Model<CircleMember>,
    @InjectModel(CircleSession.name) private sessionModel: Model<CircleSession>,
  ) {}

  // ---------------- generation ----------------

  /** Daily at 03:00 UTC: keep every active circle's next 4 weeks planned. */
  @Cron('0 3 * * *', { name: 'circle-sessions', timeZone: 'UTC' })
  async generateForAll() {
    try {
      const circles = await this.circleModel.find({ status: 'active' });
      for (const circle of circles) await this.generate(circle);
    } catch (err) {
      this.logger.error('Daily circle session generation failed', err as Error);
    }
  }

  /** Idempotent: the unique {circleId, startsAt} index plus upserts make re-runs harmless. */
  async generate(circle: Circle) {
    const starts = occurrences(circle.schedule, new Date(), GENERATE_AHEAD_DAYS);
    if (!starts.length) return;
    await this.sessionModel.bulkWrite(
      starts.map((startsAt) => ({
        updateOne: {
          filter: { circleId: circle._id, startsAt },
          update: {
            $setOnInsert: {
              circleId: circle._id,
              startsAt,
              durationMin: circle.schedule.durationMin,
              status: 'planned',
              entries: [],
            },
          },
          upsert: true,
        },
      })),
    );
  }

  /**
   * The schedule changed: only future planned sessions are touched. Those nobody has
   * written a goal for are regenerated at the new time; the others keep their slot.
   */
  async reschedule(circle: Circle) {
    const now = new Date();
    await this.sessionModel.deleteMany({
      circleId: circle._id,
      status: 'planned',
      startsAt: { $gt: now },
      entries: { $size: 0 },
    });
    await this.sessionModel.updateMany(
      { circleId: circle._id, status: 'planned', startsAt: { $gt: now } },
      { durationMin: circle.schedule.durationMin },
    );
    await this.generate(circle);
  }

  async cancelFuture(circleId: Types.ObjectId) {
    await this.sessionModel.updateMany(
      { circleId, status: 'planned', startsAt: { $gt: new Date() } },
      { status: 'cancelled' },
    );
  }

  // ---------------- reading (members only) ----------------

  /** Active and paused members (and the owner) can read goals; everybody else gets a 403. */
  private async assertCanRead(circleId: Types.ObjectId, userId: string) {
    const member = await this.memberModel
      .findOne({ circleId, userId: new Types.ObjectId(userId), status: { $in: ['active', 'paused'] } })
      .lean();
    if (!member) throw new ForbiddenException('Only members of this circle can see its sessions');
    return member;
  }

  async list(circleId: string, userId: string) {
    const id = oid(circleId);
    await this.assertCanRead(id, userId);
    const since = new Date(Date.now() - PAST_DAYS_SHOWN * 24 * 60 * 60 * 1000);
    return this.sessionModel
      .find({ circleId: id, startsAt: { $gte: since } })
      .sort({ startsAt: 1 })
      .populate('entries.userId', 'username firstName lastName profilePhotoUrl')
      .lean();
  }

  async findOne(circleId: string, sessionId: string, userId: string) {
    const id = oid(circleId);
    await this.assertCanRead(id, userId);
    const session = await this.sessionModel
      .findOne({ _id: oid(sessionId), circleId: id })
      .populate('entries.userId', 'username firstName lastName profilePhotoUrl')
      .lean();
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  // ---------------- goal and checkout (own entry only) ----------------

  /** Only an *active* member may write — paused members have to be re-activated first. */
  private async loadForWrite(circleId: string, sessionId: string, userId: string) {
    const id = oid(circleId);
    const member = await this.memberModel
      .findOne({ circleId: id, userId: new Types.ObjectId(userId), status: 'active' })
      .lean();
    if (!member) throw new ForbiddenException('Only active members of this circle can do this');

    const session = await this.sessionModel.findOne({ _id: oid(sessionId), circleId: id }).lean();
    if (!session) throw new NotFoundException('Session not found');
    if (session.status === 'cancelled') throw new BadRequestException('This session was cancelled');
    return session;
  }

  /** Writes one field set on the caller's own entry, creating the entry on first use. */
  private async writeEntry(sessionId: Types.ObjectId, userId: string, fields: Record<string, unknown>) {
    const uid = new Types.ObjectId(userId);
    const $set = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`entries.$.${k}`, v]));

    const updated = await this.sessionModel.updateOne(
      { _id: sessionId, 'entries.userId': uid },
      { $set },
    );
    if (updated.matchedCount === 0) {
      await this.sessionModel.updateOne(
        { _id: sessionId, 'entries.userId': { $ne: uid } },
        { $push: { entries: { userId: uid, attended: false, ...fields } } },
      );
    }
    return this.sessionModel.findById(sessionId).lean();
  }

  async setGoal(circleId: string, sessionId: string, userId: string, dto: GoalDto) {
    const session = await this.loadForWrite(circleId, sessionId, userId);
    if (session.status !== 'planned') throw new BadRequestException('This session is already over');
    if (!isGoalWindowOpen(session.startsAt, session.durationMin)) {
      throw new BadRequestException(
        'Goals can be set from 24 hours before the session until it ends',
      );
    }
    return this.writeEntry(session._id, userId, { goal: dto.goal });
  }

  async checkout(circleId: string, sessionId: string, userId: string, dto: CheckoutDto) {
    const session = await this.loadForWrite(circleId, sessionId, userId);
    if (!isCheckoutWindowOpen(session.startsAt, session.durationMin)) {
      throw new BadRequestException(
        'Checkout opens when the session starts and closes 24 hours after it ends',
      );
    }
    return this.writeEntry(session._id, userId, {
      result: dto.result,
      attended: true,
      ...(dto.note !== undefined ? { note: dto.note } : {}),
    });
  }

  // ---------------- owner ----------------

  async updateStatus(circleId: string, sessionId: string, userId: string, dto: UpdateSessionDto) {
    const id = oid(circleId);
    const circle = await this.circleModel.findById(id).lean();
    if (!circle) throw new NotFoundException('Circle not found');
    if (circle.ownerId.toString() !== userId) {
      throw new ForbiddenException('Only the owner can change a session');
    }

    const session = await this.sessionModel.findOne({ _id: oid(sessionId), circleId: id });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== 'planned') throw new BadRequestException('This session is already closed');

    const now = Date.now();
    if (dto.status === 'cancelled' && sessionEnd(session.startsAt, session.durationMin).getTime() < now) {
      throw new BadRequestException('A session that already ended cannot be cancelled');
    }
    if (dto.status === 'done' && session.startsAt.getTime() > now) {
      throw new BadRequestException('A session can only be marked done once it has started');
    }

    session.status = dto.status;
    await session.save();
    return session;
  }
}
