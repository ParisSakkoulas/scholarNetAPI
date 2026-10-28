import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Page } from '../../common/models/pagination-types';
import { Role } from '../../common/enums/roles.enum';
import { UserStatus } from '../../common/enums/user.status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { User } from '../users/schema/user.schema';
import { GrantCall } from './schemas/grant-call.schema';
import { GrantSave, GrantSaveState } from './schemas/grant-save.schema';
import { GrantPreference } from './schemas/grant-preference.schema';
import {
  CreateGrantDto,
  ListGrantsQuery,
  ManageGrantsQuery,
  MatchesQuery,
  PreferenceDto,
  ReviewGrantDto,
  UpdateGrantDto,
} from './dto/grant.dto';
import { buildGrantFilter, daysLeft, escapeRegex } from './util/grant-filter.util';
import { buildMatchFilter, scoreCall } from './util/grant-match.util';
import { changedFields, deadlineStage } from './util/grant-alerts.util';

const SUBMITTER_FIELDS = 'username firstName lastName';
/** Only these can be sorted on in the moderator table. */
const MANAGE_SORT_FIELDS = new Set(['title', 'funder', 'deadline', 'status', 'createdAt']);

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Grant call not found');
  return new Types.ObjectId(id);
};

/** Open until the deadline passes; an approved call whose deadline is already behind us is closed. */
const statusForDeadline = (deadline: Date): 'open' | 'closed' =>
  deadline.getTime() >= Date.now() ? 'open' : 'closed';

@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);

  constructor(
    @InjectModel(GrantCall.name) private callModel: Model<GrantCall>,
    @InjectModel(GrantSave.name) private saveModel: Model<GrantSave>,
    @InjectModel(User.name) private userModel: Model<User>,
    private notifications: NotificationsService,
    @InjectModel(GrantPreference.name) private prefModel: Model<GrantPreference>,
  ) {}

  // ---------------- housekeeping ----------------

  /** Daily at 00:10 UTC: calls whose deadline passed become `closed`. */
  @Cron('10 0 * * *', { name: 'grant-closer', timeZone: 'UTC' })
  async closeExpired() {
    try {
      const res = await this.callModel.updateMany(
        { status: 'open', deadline: { $lt: new Date() } },
        { status: 'closed' },
      );
      if (res.modifiedCount) this.logger.log(`Closed ${res.modifiedCount} expired grant call(s)`);
    } catch (err) {
      this.logger.error('Closing expired grant calls failed', err as Error);
    }
  }

  // ---------------- helpers ----------------

  private async isAdmin(userId: string) {
    const user = await this.userModel.findById(userId).select('role').lean();
    return user?.role === Role.ADMIN;
  }

  private assertConsistent(dto: Partial<CreateGrantDto>) {
    if (dto.amount?.min !== undefined && dto.amount?.max !== undefined && dto.amount.min > dto.amount.max) {
      throw new BadRequestException('amount.min cannot be higher than amount.max');
    }
    if (dto.opensAt && dto.deadline && dto.opensAt > dto.deadline) {
      throw new BadRequestException('opensAt must be before the deadline');
    }
  }

  /** The same official page should not be listed twice (rejected entries do not count). */
  private async assertNotDuplicate(url: string, exceptId?: Types.ObjectId) {
    const clash = await this.callModel.exists({
      url: new RegExp(`^${escapeRegex(url.trim().replace(/\/+$/, ''))}/?$`, 'i'),
      status: { $ne: 'rejected' },
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
    if (clash) throw new ConflictException('A call with this official link already exists');
  }

  /** The caller's own save/dismiss mark per call. */
  private async marksFor(userId: string, callIds: Types.ObjectId[]) {
    const marks = await this.saveModel
      .find({ userId: new Types.ObjectId(userId), callId: { $in: callIds } })
      .lean();
    return new Map(marks.map((m) => [m.callId.toString(), m.state]));
  }

  // ---------------- create / edit (admin) ----------------

  async create(adminId: string, dto: CreateGrantDto) {
    this.assertConsistent(dto);
    await this.assertNotDuplicate(dto.url);
    const call = await this.callModel.create({
      ...dto,
      lastCheckedAt: dto.lastCheckedAt ?? new Date(),
      status: statusForDeadline(dto.deadline),
      source: 'admin',
      submittedBy: new Types.ObjectId(adminId),
    });
    if (call.status === 'open') await this.notifyNewMatches(call, adminId);
    return call;
  }

  async update(id: string, adminId: string, dto: UpdateGrantDto) {
    const call = await this.callModel.findById(oid(id));
    if (!call) throw new NotFoundException('Grant call not found');
    this.assertConsistent({ ...call.toObject(), ...dto } as CreateGrantDto);
    if (dto.url && dto.url !== call.url) await this.assertNotDuplicate(dto.url, call._id);

    const before = call.toObject();
    call.set(dto);
    // an admin saving a call is taken as having compared it with the official page
    call.lastCheckedAt = dto.lastCheckedAt ?? new Date();
    if (dto.deadline && ['open', 'closed'].includes(call.status)) {
      call.status = statusForDeadline(dto.deadline);
    }
    await call.save();

    if (['open', 'closed'].includes(call.status)) {
      const changed = changedFields(before, call.toObject());
      if (changed.length) {
        if (changed.includes('deadline')) {
          // a new deadline means the 14 and 3 day reminders apply again
          await this.saveModel.updateMany({ callId: call._id }, { $set: { lastDeadlineAlert: null } });
        }
        await this.notifySavers(
          call,
          adminId,
          NotificationType.GRANT_UPDATED,
          `"${call.title}" was updated (${changed.join(', ')}). Check the official page.`,
        );
      }
    }
    return call;
  }

  async remove(id: string) {
    const call = await this.callModel.findByIdAndDelete(oid(id));
    if (!call) throw new NotFoundException('Grant call not found');
    await this.saveModel.deleteMany({ callId: call._id });
    return { deleted: true };
  }

  // ---------------- submit / review ----------------

  /** Any verified (email-confirmed) user can propose a call; it stays hidden until approved. */
  async submit(userId: string, dto: CreateGrantDto) {
    const user = await this.userModel.findById(userId).select('status').lean();
    if (user?.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Confirm your email address before submitting a call');
    }
    if (dto.deadline.getTime() < Date.now()) throw new BadRequestException('The deadline has already passed');
    this.assertConsistent(dto);
    await this.assertNotDuplicate(dto.url);

    return this.callModel.create({
      ...dto,
      lastCheckedAt: dto.lastCheckedAt ?? new Date(),
      status: 'pending',
      source: 'user',
      submittedBy: new Types.ObjectId(userId),
    });
  }

  async review(id: string, moderatorId: string, dto: ReviewGrantDto) {
    const call = await this.callModel.findById(oid(id));
    if (!call) throw new NotFoundException('Grant call not found');
    if (call.status !== 'pending') throw new BadRequestException('Only pending submissions can be reviewed');

    const approve = dto.decision === 'approve';
    call.status = approve ? statusForDeadline(call.deadline) : 'rejected';
    call.reviewNote = dto.note || undefined;
    call.reviewedBy = new Types.ObjectId(moderatorId);
    await call.save();

    if (approve && call.status === 'open') {
      await this.notifyNewMatches(call, moderatorId, call.submittedBy?.toString());
    }

    if (call.submittedBy) {
      await this.notifications.create({
        recipientId: call.submittedBy,
        actorId: moderatorId,
        type: approve ? NotificationType.GRANT_SUBMISSION_APPROVED : NotificationType.GRANT_SUBMISSION_REJECTED,
        message: approve
          ? `Your call "${call.title}" was approved and is now listed`
          : `Your call "${call.title}" was not approved${dto.note ? `: ${dto.note}` : ''}`.slice(0, 300),
        entityType: 'grant',
        entityId: call._id,
      });
    }
    return call;
  }

  // ---------------- reading ----------------

  /** The public list: approved calls only, soonest deadline first, closed ones hidden by default. */
  async list(userId: string, query: ListGrantsQuery): Promise<Page<unknown>> {
    const uid = new Types.ObjectId(userId);
    const tab = query.tab ?? 'all';

    const filter = buildGrantFilter({
      ...query,
      // a saved call stays in the Saved tab after it closes
      includeClosed: query.includeClosed || tab === 'saved',
    });

    if (tab === 'all') {
      const dismissed = await this.saveModel.find({ userId: uid, state: 'dismissed' }).select('callId').lean();
      if (dismissed.length) filter.$and.push({ _id: { $nin: dismissed.map((d) => d.callId) } });
    } else {
      const state: GrantSaveState = tab === 'saved' ? 'saved' : 'dismissed';
      const marked = await this.saveModel.find({ userId: uid, state }).select('callId').lean();
      filter.$and.push({ _id: { $in: marked.map((m) => m.callId) } });
    }

    const sortKey = query.sort ?? 'deadline';
    const sort: Record<string, 1 | -1> = sortKey.startsWith('-') ? { [sortKey.slice(1)]: -1 } : { [sortKey]: 1 };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;

    const [calls, total] = await Promise.all([
      this.callModel
        .find(filter)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .select('-submittedBy -reviewedBy -reviewNote')
        .lean(),
      this.callModel.countDocuments(filter),
    ]);

    const marks = await this.marksFor(userId, calls.map((c) => c._id));
    return { total, data: calls.map((c) => ({ ...c, mySave: marks.get(c._id.toString()) ?? null })) };
  }

  /** Moderator table: every status, with the generic table's search, sort and paging. */
  async manage(query: ManageGrantsQuery): Promise<Page<unknown>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.search?.trim()) {
      const rx = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
      filter.$or = [{ title: rx }, { funder: rx }];
    }
    const sortField = query.sortField && MANAGE_SORT_FIELDS.has(query.sortField) ? query.sortField : 'createdAt';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortOrder === 'asc' ? 1 : -1 };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const [data, total] = await Promise.all([
      this.callModel
        .find(filter)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate('submittedBy', SUBMITTER_FIELDS)
        .lean(),
      this.callModel.countDocuments(filter),
    ]);
    return { data, total };
  }

  /** What the caller has submitted, with the outcome and the moderator's note. */
  mySubmissions(userId: string) {
    return this.callModel
      .find({ submittedBy: new Types.ObjectId(userId), source: 'user' })
      .sort({ createdAt: -1 })
      .lean();
  }

  async findOne(id: string, userId: string) {
    const call = await this.callModel.findById(oid(id)).populate('submittedBy', SUBMITTER_FIELDS).lean();
    if (!call) throw new NotFoundException('Grant call not found');

    const approved = call.status === 'open' || call.status === 'closed';
    const submitterId = (call.submittedBy as any)?._id?.toString();
    if (!approved && submitterId !== userId && !(await this.isAdmin(userId))) {
      // pending and rejected calls do not exist for anybody else
      throw new NotFoundException('Grant call not found');
    }

    const marks = await this.marksFor(userId, [call._id]);
    const admin = await this.isAdmin(userId);
    const { reviewNote, reviewedBy, submittedBy, ...publicFields } = call as any;
    return {
      ...publicFields,
      ...(admin || submitterId === userId ? { reviewNote, submittedBy } : {}),
      mySave: marks.get(call._id.toString()) ?? null,
    };
  }

  // ---------------- preferences and matching ----------------

  async getPreferences(userId: string) {
    const pref = await this.prefModel.findOne({ userId: new Types.ObjectId(userId) }).lean();
    return (
      pref ?? { countries: [], careerStage: null, fields: [], fundingTypes: [], alertsEnabled: true, saved: false }
    );
  }

  async setPreferences(userId: string, dto: PreferenceDto) {
    const set: Record<string, unknown> = {};
    if (dto.countries !== undefined) set.countries = dto.countries;
    if (dto.fields !== undefined) set.fields = dto.fields;
    if (dto.fundingTypes !== undefined) set.fundingTypes = dto.fundingTypes;
    if (dto.alertsEnabled !== undefined) set.alertsEnabled = dto.alertsEnabled;
    return this.prefModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $set: set,
          // an empty career stage clears it
          ...(dto.careerStage === undefined ? { $unset: { careerStage: '' } } : { $set: { ...set, careerStage: dto.careerStage } }),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean();
  }

  /**
   * "For you": open calls that pass the user's hard rules, with a fit score and short reasons.
   * Scored in memory: the candidate set is already narrowed by the database and capped.
   */
  async matches(userId: string, query: MatchesQuery) {
    const uid = new Types.ObjectId(userId);
    const pref = await this.prefModel.findOne({ userId: uid }).lean();
    if (!pref) return { data: [], total: 0, hasPreferences: false };

    const filter = buildMatchFilter(pref);
    const dismissed = await this.saveModel.find({ userId: uid, state: 'dismissed' }).select('callId').lean();
    if (dismissed.length) filter.$and.push({ _id: { $nin: dismissed.map((d) => d.callId) } });

    const candidates = await this.callModel
      .find(filter)
      .select('-submittedBy -reviewedBy -reviewNote')
      .limit(500)
      .lean();
    const scored = candidates
      .map((c) => ({ call: c, fit: scoreCall(pref, c) }))
      .filter((x): x is { call: (typeof candidates)[number]; fit: NonNullable<ReturnType<typeof scoreCall>> } => !!x.fit)
      .sort((a, b) => b.fit.score - a.fit.score || a.call.deadline.getTime() - b.call.deadline.getTime());

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const slice = scored.slice((page - 1) * pageSize, page * pageSize);
    const marks = await this.marksFor(userId, slice.map((x) => x.call._id));

    return {
      total: scored.length,
      hasPreferences: true,
      data: slice.map((x) => ({ ...x.call, fit: x.fit, mySave: marks.get(x.call._id.toString()) ?? null })),
    };
  }

  // ---------------- alerts ----------------

  /** People who turned alerts off hear nothing, whatever the reason. */
  private async mutedAmong(userIds: Types.ObjectId[]): Promise<Set<string>> {
    const muted = await this.prefModel.find({ userId: { $in: userIds }, alertsEnabled: false }).select('userId').lean();
    return new Set(muted.map((m) => m.userId.toString()));
  }

  /** A call just went public: tell everybody whose preferences it fits. */
  private async notifyNewMatches(call: GrantCall, actorId: string, alsoSkip?: string) {
    try {
      const prefs = await this.prefModel.find({ alertsEnabled: true }).limit(5000).lean();
      const targets = prefs.filter(
        (p) => p.userId.toString() !== actorId && p.userId.toString() !== alsoSkip,
      );
      await Promise.all(
        targets.map(async (p) => {
          const fit = scoreCall(p, call);
          if (!fit) return;
          await this.notifications.create({
            recipientId: p.userId,
            actorId,
            type: NotificationType.GRANT_NEW_MATCH,
            message: `New call for you: "${call.title}". ${fit.reasons[0]}`.slice(0, 300),
            entityType: 'grant',
            entityId: call._id,
          });
        }),
      );
    } catch (err) {
      this.logger.error('Notifying new grant matches failed', err as Error);
    }
  }

  private async notifySavers(call: GrantCall, actorId: string, type: NotificationType, message: string) {
    try {
      const saves = await this.saveModel.find({ callId: call._id, state: 'saved' }).select('userId').lean();
      const muted = await this.mutedAmong(saves.map((s) => s.userId));
      await Promise.all(
        saves
          .filter((s) => !muted.has(s.userId.toString()))
          .map((s) =>
            this.notifications.create({
              recipientId: s.userId,
              actorId,
              type,
              message: message.slice(0, 300),
              entityType: 'grant',
              entityId: call._id,
            }),
          ),
      );
    } catch (err) {
      this.logger.error('Notifying savers failed', err as Error);
    }
  }

  /**
   * Daily at 08:00 UTC: saved calls that are 14 or 3 days from their deadline. Each stage is sent
   * once per saved call (lastDeadlineAlert); a call first saved late skips the stages already past.
   */
  @Cron('0 8 * * *', { name: 'grant-deadline-reminders', timeZone: 'UTC' })
  async remindSavedDeadlines() {
    try {
      const now = new Date();
      const calls = await this.callModel
        .find({ status: 'open', deadline: { $gte: now, $lte: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000) } })
        .lean();

      for (const call of calls) {
        const left = daysLeft(call.deadline, now);
        const stage = deadlineStage(left);
        if (!stage) continue;

        const saves = await this.saveModel
          .find({ callId: call._id, state: 'saved', lastDeadlineAlert: { $in: stage === 3 ? [null, 14] : [null] } })
          .select('userId')
          .lean();
        if (!saves.length) continue;

        const muted = await this.mutedAmong(saves.map((s) => s.userId));
        await Promise.all(
          saves
            .filter((s) => !muted.has(s.userId.toString()))
            .map((s) =>
              this.notifications.create({
                recipientId: s.userId,
                type: NotificationType.GRANT_DEADLINE_SOON,
                message: `"${call.title}" closes in ${left <= 0 ? 'less than a day' : left === 1 ? '1 day' : `${left} days`}`,
                entityType: 'grant',
                entityId: call._id,
              }),
            ),
        );
        // muted users are marked too, so turning alerts on later does not replay old stages
        await this.saveModel.updateMany({ _id: { $in: saves.map((s) => s._id) } }, { $set: { lastDeadlineAlert: stage } });
      }
    } catch (err) {
      this.logger.error('Saved-call deadline reminders failed', err as Error);
    }
  }

  // ---------------- save / dismiss ----------------

  private async mark(id: string, userId: string, state: GrantSaveState) {
    const callId = oid(id);
    const call = await this.callModel.findById(callId).select('status').lean();
    if (!call || !['open', 'closed'].includes(call.status)) throw new NotFoundException('Grant call not found');
    await this.saveModel.updateOne(
      { userId: new Types.ObjectId(userId), callId },
      { $set: { state } },
      { upsert: true },
    );
    return { state };
  }

  save(id: string, userId: string) {
    return this.mark(id, userId, 'saved');
  }

  dismiss(id: string, userId: string) {
    return this.mark(id, userId, 'dismissed');
  }

  /** Clears the mark, whichever it was: un-save or un-dismiss. */
  async unmark(id: string, userId: string) {
    await this.saveModel.deleteOne({ userId: new Types.ObjectId(userId), callId: oid(id) });
    return { state: null };
  }
}
