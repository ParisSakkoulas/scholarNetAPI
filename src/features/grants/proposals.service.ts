import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { FileStorage } from '../../common/storage/file-storage';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { TeamMember } from '../teams/schema/team-member.schema';
import { Board } from '../projects/schema/board.schema';
import { Column } from '../projects/schema/column.schema';
import { ProjectsService } from '../projects/projects.service';
import { Task } from '../tasks/schema/task.schema';
import { DOCUMENT_EXTENSIONS, decodeUploadName, detectDocumentType } from '../supervisions/document-file.util';
import { GrantCall } from './schemas/grant-call.schema';
import { Proposal } from './schemas/proposal.schema';
import { ProposalSection } from './schemas/proposal-section.schema';
import { ProposalFile } from './schemas/proposal-file.schema';
import { ProposalReview } from './schemas/proposal-review.schema';
import { Comment } from '../tasks/schema/comment.schema';
import { CreateSectionDto, StartProposalDto, UpdateProposalDto, UpdateSectionDto } from './dto/proposal.dto';
import { CARD_FOR_STATUS, DEFAULT_SECTIONS, remindersDue, sectionReminderDue } from './util/proposal.util';

const PERSON_FIELDS = 'username firstName lastName profilePhotoUrl';
const CALL_FIELDS = 'title funder url deadline status lastCheckedAt';
const MAX_FILES_PER_SECTION = 10;
const POSITION_STEP = 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Submitted / awarded / not funded stamp their dates; going back to work clears them. */
export function applyOutcomeDates(p: { status: string; submittedAt?: Date; decidedAt?: Date }, now = new Date()) {
  if (p.status === 'submitted') {
    p.submittedAt ??= now;
    p.decidedAt = undefined;
  } else if (p.status === 'awarded' || p.status === 'rejected') {
    p.submittedAt ??= now;
    p.decidedAt ??= now;
  } else {
    p.submittedAt = undefined;
    p.decidedAt = undefined;
  }
}

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
  return new Types.ObjectId(id);
};

/** What the caller may do with one proposal. */
export interface ProposalAccess {
  proposal: Proposal;
  userId: string;
  /** Owner of the proposal, or owner/admin of its team: settings, assignments, deleting. */
  canManage: boolean;
  /** Everybody above plus plain team members: sections, status and files. Viewers only read. */
  canWrite: boolean;
  /** Not on the team: only here because someone asked them to review a section. */
  isReviewer: boolean;
  /** The sections a reviewer may read and comment on. Empty for everybody else. */
  reviewSectionIds: string[];
}

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);
  private readonly maxFileBytes: number;

  constructor(
    @InjectModel(Proposal.name) private proposalModel: Model<Proposal>,
    @InjectModel(ProposalSection.name) private sectionModel: Model<ProposalSection>,
    @InjectModel(ProposalFile.name) private fileModel: Model<ProposalFile>,
    @InjectModel(GrantCall.name) private callModel: Model<GrantCall>,
    @InjectModel(TeamMember.name) private memberModel: Model<TeamMember>,
    @InjectModel(Task.name) private taskModel: Model<Task>,
    @InjectModel(Column.name) private columnModel: Model<Column>,
    @InjectModel(Board.name) private boardModel: Model<Board>,
    @InjectModel(ProposalReview.name) private reviewModel: Model<ProposalReview>,
    @InjectModel(Comment.name) private commentModel: Model<Comment>,
    private projects: ProjectsService,
    private notifications: NotificationsService,
    private storage: FileStorage,
    config: ConfigService,
  ) {
    this.maxFileBytes = Number(config.get('PROPOSAL_FILE_MAX_MB') ?? 25) * 1024 * 1024;
  }

  // ---------------- access ----------------

  /**
   * Team proposals follow the team; personal ones belong to their owner. Somebody asked to review a
   * section can see just that section. Everybody else gets a 404.
   */
  async access(id: string, userId: string): Promise<ProposalAccess> {
    const proposal = await this.proposalModel.findById(oid(id));
    if (!proposal) throw new NotFoundException('Proposal not found');

    const insider = (canManage: boolean, canWrite: boolean): ProposalAccess => ({
      proposal, userId, canManage, canWrite, isReviewer: false, reviewSectionIds: [],
    });

    if (!proposal.teamId) {
      if (proposal.ownerId.toString() === userId) return insider(true, true);
    } else {
      const member = await this.memberModel
        .findOne({ teamId: proposal.teamId, userId: new Types.ObjectId(userId), status: 'active' })
        .lean();
      if (member) {
        const canManage =
          proposal.ownerId.toString() === userId || member.role === 'owner' || member.role === 'admin';
        return insider(canManage, canManage || member.role === 'member');
      }
    }

    // not on the team: is this person a reviewer?
    const reviews = await this.reviewModel
      .find({ proposalId: proposal._id, reviewerId: new Types.ObjectId(userId), status: { $ne: 'cancelled' } })
      .select('sectionId')
      .lean();
    if (!reviews.length) throw new NotFoundException('Proposal not found');
    return {
      proposal,
      userId,
      canManage: false,
      canWrite: false,
      isReviewer: true,
      reviewSectionIds: [...new Set(reviews.map((r) => r.sectionId.toString()))],
    };
  }

  private assertWrite(a: ProposalAccess) {
    if (!a.canWrite) throw new ForbiddenException('You can only read this proposal');
  }

  private assertManage(a: ProposalAccess, what: string) {
    if (!a.canManage) throw new ForbiddenException(`Only the proposal owner or the team's admins and owner can ${what}`);
  }

  /** People who work on a proposal: the team's active non-viewers, or just the owner. */
  private async workers(proposal: Proposal): Promise<Types.ObjectId[]> {
    if (!proposal.teamId) return [proposal.ownerId];
    const members = await this.memberModel
      .find({ teamId: proposal.teamId, status: 'active', role: { $ne: 'viewer' } })
      .select('userId')
      .lean();
    return members.map((m) => m.userId);
  }

  private async loadCall(proposal: Proposal) {
    const call = await this.callModel.findById(proposal.callId).select(CALL_FIELDS).lean();
    if (!call) throw new NotFoundException('The grant call of this proposal no longer exists');
    return call;
  }

  // ---------------- start ----------------

  /** "Start proposal": a proposal, its default sections and, for a team, a Kanban board. */
  async start(userId: string, callId: string, dto: StartProposalDto) {
    const call = await this.callModel.findById(oid(callId)).lean();
    if (!call || !['open', 'closed'].includes(call.status)) throw new NotFoundException('Grant call not found');
    if (call.status !== 'open' || call.deadline.getTime() < Date.now()) {
      throw new BadRequestException('Proposals can only be started on open calls');
    }
    if (dto.internalDeadline) this.assertInternalDeadline(dto.internalDeadline, call.deadline);

    const uid = new Types.ObjectId(userId);
    let teamId: Types.ObjectId | undefined;
    if (dto.teamId) {
      teamId = oid(dto.teamId);
      const member = await this.memberModel.findOne({ teamId, userId: uid, status: 'active' }).lean();
      if (!member || member.role === 'viewer') {
        throw new ForbiddenException('You need to be an active member of this team (not a viewer) to start a proposal for it');
      }
    }

    const clash = await this.proposalModel.exists({
      callId: call._id,
      ...(teamId ? { teamId } : { teamId: null, ownerId: uid }),
    });
    if (clash) {
      throw new ConflictException(
        teamId ? 'This team already has a proposal for this call' : 'You already started a personal proposal for this call',
      );
    }

    const proposal = await this.proposalModel.create({
      callId: call._id,
      teamId,
      ownerId: uid,
      title: dto.title ?? call.title,
      internalDeadline: dto.internalDeadline,
    });

    try {
      const sections = await this.sectionModel.insertMany(
        DEFAULT_SECTIONS.map((title, i) => ({ proposalId: proposal._id, title, position: (i + 1) * POSITION_STEP })),
      );

      if (teamId) {
        const project = await this.projects.create(
          teamId.toString(),
          {
            name: proposal.title.slice(0, 120),
            description: `Proposal for "${call.title}" (${call.funder})`,
            dueDate: (proposal.internalDeadline ?? call.deadline).toISOString(),
          },
          userId,
        );
        const board = await this.boardModel.findOne({ projectId: project._id }).lean();
        proposal.projectId = project._id as Types.ObjectId;
        proposal.boardId = board?._id as Types.ObjectId | undefined;
        await proposal.save();
        for (const section of sections) await this.syncCard(proposal, section, userId);
      }
    } catch (err) {
      // do not leave a half-built proposal behind
      await this.sectionModel.deleteMany({ proposalId: proposal._id });
      await proposal.deleteOne();
      throw err;
    }
    return proposal;
  }

  private assertInternalDeadline(internal: Date, official: Date) {
    if (internal.getTime() > official.getTime()) {
      throw new BadRequestException("The internal deadline must be before the funder's deadline");
    }
  }

  // ---------------- read ----------------

  /** My proposals: the personal ones I own, and those of every team I am an active member of. */
  async list(userId: string, callId?: string) {
    const uid = new Types.ObjectId(userId);
    const teams = await this.memberModel.find({ userId: uid, status: 'active' }).select('teamId').lean();
    const filter: Record<string, unknown> = {
      $or: [{ teamId: null, ownerId: uid }, { teamId: { $in: teams.map((t) => t.teamId) } }],
    };
    if (callId) filter.callId = oid(callId);

    const proposals = await this.proposalModel
      .find(filter)
      .populate('callId', CALL_FIELDS)
      .populate('teamId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const stats = await this.sectionModel.aggregate<{ _id: Types.ObjectId; total: number; done: number }>([
      { $match: { proposalId: { $in: proposals.map((p) => p._id) } } },
      { $group: { _id: '$proposalId', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } } } },
    ]);
    const byId = new Map(stats.map((s) => [s._id.toString(), s]));
    return proposals.map((p) => ({
      ...p,
      progress: { total: byId.get(p._id.toString())?.total ?? 0, done: byId.get(p._id.toString())?.done ?? 0 },
    }));
  }

  async get(id: string, userId: string) {
    const a = await this.access(id, userId);
    const proposal = await this.proposalModel
      .findById(a.proposal._id)
      .populate('callId', CALL_FIELDS)
      .populate('teamId', 'name')
      .lean();

    // a reviewer sees only the sections they were asked about
    const sectionFilter: Record<string, unknown> = { proposalId: a.proposal._id };
    if (a.isReviewer) sectionFilter._id = { $in: a.reviewSectionIds.map((s) => new Types.ObjectId(s)) };

    const sections = await this.sectionModel
      .find(sectionFilter)
      .sort({ position: 1 })
      .populate('ownerId', PERSON_FIELDS)
      .lean();
    const sectionIds = sections.map((s) => s._id);
    const files = await this.fileModel
      .find({ proposalId: a.proposal._id, sectionId: { $in: sectionIds } })
      .sort({ createdAt: 1 })
      .populate('uploadedBy', PERSON_FIELDS)
      .lean();
    const reviews = await this.reviewModel
      .find({ proposalId: a.proposal._id, sectionId: { $in: sectionIds }, status: { $ne: 'cancelled' } })
      .sort({ createdAt: 1 })
      .populate('reviewerId', PERSON_FIELDS)
      .populate('requestedBy', PERSON_FIELDS)
      .lean();

    return {
      ...proposal,
      sections: sections.map((s) => ({
        ...s,
        files: files.filter((f) => f.sectionId.toString() === s._id.toString()),
        reviews: reviews.filter((r) => r.sectionId.toString() === s._id.toString()),
      })),
      access: { canManage: a.canManage, canWrite: a.canWrite, isReviewer: a.isReviewer },
    };
  }

  // ---------------- proposal settings ----------------

  async update(id: string, userId: string, dto: UpdateProposalDto) {
    const a = await this.access(id, userId);
    this.assertManage(a, 'change the proposal');
    const proposal = a.proposal;

    if (dto.title !== undefined) proposal.title = dto.title;
    if (dto.status !== undefined) {
      proposal.status = dto.status as Proposal['status'];
      applyOutcomeDates(proposal);
    }
    if (dto.outcomeNote !== undefined) proposal.outcomeNote = dto.outcomeNote ?? undefined;
    if (dto.internalDeadline !== undefined) {
      if (dto.internalDeadline) {
        const call = await this.loadCall(proposal);
        this.assertInternalDeadline(dto.internalDeadline, call.deadline);
        proposal.internalDeadline = dto.internalDeadline;
      } else {
        proposal.internalDeadline = undefined;
      }
    }
    await proposal.save();
    return proposal;
  }

  async remove(id: string, userId: string) {
    const a = await this.access(id, userId);
    this.assertManage(a, 'delete the proposal');

    const files = await this.fileModel.find({ proposalId: a.proposal._id }).select('+storageKey').lean();
    await Promise.all(files.map((f) => this.storage.delete(f.storageKey)));
    const sections = await this.sectionModel.find({ proposalId: a.proposal._id }).select('taskId').lean();

    await this.fileModel.deleteMany({ proposalId: a.proposal._id });
    await this.reviewModel.deleteMany({ proposalId: a.proposal._id });
    await this.commentModel.deleteMany({ entityType: 'proposal_section', entityId: { $in: sections.map((s) => s._id) } });
    await this.sectionModel.deleteMany({ proposalId: a.proposal._id });
    // the section cards go with it; the team's project and board stay
    await this.taskModel.deleteMany({ _id: { $in: sections.map((s) => s.taskId).filter(Boolean) } });
    await a.proposal.deleteOne();
    return { deleted: true };
  }

  // ---------------- sections ----------------

  private async findSection(proposalId: Types.ObjectId, sectionId: string) {
    const section = await this.sectionModel.findOne({ _id: oid(sectionId), proposalId });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  async addSection(id: string, userId: string, dto: CreateSectionDto) {
    const a = await this.access(id, userId);
    this.assertWrite(a);
    if (dto.dueDate) this.assertDueDate(dto.dueDate, (await this.loadCall(a.proposal)).deadline);

    const last = await this.sectionModel.findOne({ proposalId: a.proposal._id }).sort({ position: -1 }).lean();
    const section = await this.sectionModel.create({
      proposalId: a.proposal._id,
      title: dto.title,
      dueDate: dto.dueDate,
      position: (last?.position ?? 0) + POSITION_STEP,
    });
    await this.syncCard(a.proposal, section, userId);
    return section;
  }

  private assertDueDate(due: Date, official: Date) {
    if (due.getTime() > official.getTime()) {
      throw new BadRequestException("A section cannot be due after the funder's deadline");
    }
  }

  async updateSection(id: string, sectionId: string, userId: string, dto: UpdateSectionDto) {
    const a = await this.access(id, userId);
    this.assertWrite(a);
    const section = await this.findSection(a.proposal._id as Types.ObjectId, sectionId);

    let newOwner: Types.ObjectId | undefined;
    if (dto.ownerId !== undefined) {
      this.assertManage(a, 'assign sections');
      if (dto.ownerId === null) {
        section.ownerId = undefined;
      } else {
        newOwner = oid(dto.ownerId);
        const eligible = (await this.workers(a.proposal)).some((w) => w.toString() === newOwner!.toString());
        if (!eligible) throw new BadRequestException('Sections can only be assigned to people who work on this proposal');
        if (section.ownerId?.toString() !== newOwner.toString()) section.ownerId = newOwner;
        else newOwner = undefined; // unchanged: nobody to notify
      }
    }

    if (dto.dueDate !== undefined) {
      if (dto.dueDate) this.assertDueDate(dto.dueDate, (await this.loadCall(a.proposal)).deadline);
      section.dueDate = dto.dueDate ?? undefined;
    }
    if (dto.title !== undefined) section.title = dto.title;
    if (dto.status !== undefined) section.status = dto.status as ProposalSection['status'];

    await section.save();
    await this.syncCard(a.proposal, section, userId);

    if (newOwner && newOwner.toString() !== userId) {
      await this.notifications.create({
        recipientId: newOwner,
        actorId: userId,
        type: NotificationType.PROPOSAL_SECTION_ASSIGNED,
        message: `You were assigned "${section.title}" in "${a.proposal.title}"`.slice(0, 300),
        entityType: 'proposal',
        entityId: a.proposal._id as Types.ObjectId,
      });
    }
    return section;
  }

  async removeSection(id: string, sectionId: string, userId: string) {
    const a = await this.access(id, userId);
    this.assertWrite(a);
    const section = await this.findSection(a.proposal._id as Types.ObjectId, sectionId);

    const files = await this.fileModel.find({ sectionId: section._id }).select('+storageKey').lean();
    await Promise.all(files.map((f) => this.storage.delete(f.storageKey)));
    await this.fileModel.deleteMany({ sectionId: section._id });
    await this.reviewModel.deleteMany({ sectionId: section._id });
    await this.commentModel.deleteMany({ entityType: 'proposal_section', entityId: section._id });
    if (section.taskId) await this.taskModel.deleteOne({ _id: section.taskId });
    await section.deleteOne();
    return { deleted: true };
  }

  // ---------------- Kanban cards ----------------

  /**
   * Keeps the section's card on the team board in step with the section (title, owner, due date, column).
   * The section is the source of truth: moving a card by hand does not change the section.
   * A board problem must never break the section change, so it is only logged.
   */
  private async syncCard(proposal: Proposal, section: ProposalSection, actorId: string) {
    if (!proposal.projectId || !proposal.boardId) return;
    try {
      const target = CARD_FOR_STATUS[section.status];
      const columns = await this.columnModel.find({ boardId: proposal.boardId }).sort({ position: 1 }).lean();
      const column = columns.find((c) => c.name === target.column) ?? columns[0];
      if (!column) return;

      const fields = {
        title: section.title,
        assigneeIds: section.ownerId ? [section.ownerId] : [],
        dueDate: section.dueDate ?? undefined,
        status: target.status,
        doneAt: target.status === 'done' ? new Date() : null,
      };

      const existing = section.taskId ? await this.taskModel.findById(section.taskId).lean() : null;
      if (existing) {
        const moved = existing.columnId.toString() !== column._id.toString();
        await this.taskModel.updateOne(
          { _id: existing._id },
          {
            $set: {
              ...fields,
              // keep the original completion time while it stays done
              doneAt: target.status === 'done' ? (existing.doneAt ?? new Date()) : null,
              ...(moved ? { columnId: column._id, position: await this.nextPosition(column._id) } : {}),
            },
          },
        );
        return;
      }

      const task = await this.taskModel.create({
        ...fields,
        projectId: proposal.projectId,
        columnId: column._id,
        position: await this.nextPosition(column._id),
        description: `Section of the proposal "${proposal.title}"`,
        createdBy: new Types.ObjectId(actorId),
      });
      section.taskId = task._id as Types.ObjectId;
      await section.save();
    } catch (err) {
      this.logger.error(`Could not sync the board card for section ${section._id}`, err as Error);
    }
  }

  private async nextPosition(columnId: Types.ObjectId) {
    const last = await this.taskModel.findOne({ columnId }).sort({ position: -1 }).select('position').lean();
    return (last?.position ?? 0) + POSITION_STEP;
  }

  // ---------------- attached drafts ----------------

  async uploadFile(id: string, sectionId: string, userId: string, file: Express.Multer.File | undefined) {
    const a = await this.access(id, userId);
    this.assertWrite(a);
    const section = await this.findSection(a.proposal._id as Types.ObjectId, sectionId);

    if (!file) throw new BadRequestException('No file received (send it as the "file" field).');
    if (section.fileIds.length >= MAX_FILES_PER_SECTION) {
      throw new BadRequestException(`A section can hold up to ${MAX_FILES_PER_SECTION} files.`);
    }
    if (file.size > this.maxFileBytes) {
      throw new BadRequestException(`The file is larger than ${Math.round(this.maxFileBytes / 1048576)} MB.`);
    }
    const type = detectDocumentType(file.originalname, file.buffer);
    if (!type) {
      throw new BadRequestException(
        `Only ${DOCUMENT_EXTENSIONS.join(', ')} files are accepted, and the content must match the extension.`,
      );
    }

    const storageKey = `proposals/${a.proposal._id}/${randomUUID()}${type.ext}`;
    await this.storage.save(storageKey, file.buffer);
    try {
      const stored = await this.fileModel.create({
        proposalId: a.proposal._id,
        sectionId: section._id,
        uploadedBy: new Types.ObjectId(userId),
        storageKey,
        // eslint-disable-next-line no-control-regex
        fileName: decodeUploadName(file.originalname).replace(/[\u0000-\u001F\u007F"\\/]/g, '_').slice(0, 200),
        mimeType: type.mimeType,
        size: file.size,
      });
      await this.sectionModel.updateOne({ _id: section._id }, { $push: { fileIds: stored._id } });
      const { storageKey: _omit, ...view } = stored.toObject();
      return view;
    } catch (err) {
      await this.storage.delete(storageKey); // do not leave an orphan on disk
      throw err;
    }
  }

  async openFile(id: string, fileId: string, userId: string) {
    const a = await this.access(id, userId);
    const file = await this.fileModel.findOne({ _id: oid(fileId), proposalId: a.proposal._id }).select('+storageKey').lean();
    if (!file) throw new NotFoundException('File not found');
    // a reviewer can download drafts of the sections they review, and nothing else
    if (a.isReviewer && !a.reviewSectionIds.includes(file.sectionId.toString())) {
      throw new NotFoundException('File not found');
    }
    return {
      stream: await this.storage.read(file.storageKey),
      name: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
    };
  }

  async removeFile(id: string, fileId: string, userId: string) {
    const a = await this.access(id, userId);
    this.assertWrite(a);
    const file = await this.fileModel.findOne({ _id: oid(fileId), proposalId: a.proposal._id }).select('+storageKey');
    if (!file) throw new NotFoundException('File not found');
    await this.storage.delete(file.storageKey);
    await this.sectionModel.updateOne({ _id: file.sectionId }, { $pull: { fileIds: file._id } });
    await file.deleteOne();
    return { deleted: true };
  }

  /** Moves a section to a new status and keeps its board card in step. Used by the review flow. */
  async setSectionStatus(proposal: Proposal, section: ProposalSection, status: ProposalSection['status'], actorId: string) {
    section.status = status;
    await section.save();
    await this.syncCard(proposal, section, actorId);
  }

  // ---------------- personal history ----------------

  /** How many proposals I led, how many were submitted, awarded or turned down. */
  async history(userId: string) {
    const mine = await this.proposalModel
      .find({ ownerId: new Types.ObjectId(userId) })
      .populate('callId', 'title funder')
      .sort({ decidedAt: -1, createdAt: -1 })
      .lean();

    const count = (status: string) => mine.filter((p) => p.status === status).length;
    const awarded = count('awarded');
    const notFunded = count('rejected');
    const decided = awarded + notFunded;
    return {
      total: mine.length,
      active: mine.filter((p) => ['planning', 'writing', 'review'].includes(p.status)).length,
      submitted: mine.filter((p) => ['submitted', 'awarded', 'rejected'].includes(p.status)).length,
      awaiting: count('submitted'),
      awarded,
      notFunded,
      /** awarded out of the ones that got an answer; null until there is one */
      successRate: decided ? Math.round((awarded / decided) * 100) : null,
      decidedProposals: mine
        .filter((p) => p.status === 'awarded' || p.status === 'rejected')
        .slice(0, 10)
        .map((p) => ({
          _id: p._id,
          title: p.title,
          funder: (p.callId as any)?.funder,
          status: p.status,
          decidedAt: p.decidedAt,
          outcomeNote: p.outcomeNote,
        })),
    };
  }

  // ---------------- reminders ----------------

  /**
   * Daily at 08:05 UTC: the funder's deadline at 14 and 3 days, the internal deadline at 3 days,
   * and unfinished sections in their last 2 days. Each is sent once per deadline value.
   */
  @Cron('5 8 * * *', { name: 'proposal-reminders', timeZone: 'UTC' })
  async sendReminders() {
    try {
      const now = new Date();
      const proposals = await this.proposalModel
        .find({ status: { $in: ['planning', 'writing', 'review'] } })
        .populate('callId', 'deadline')
        .lean();

      const active = new Map(proposals.map((p) => [p._id.toString(), p]));

      for (const p of proposals) {
        const call = p.callId as unknown as { deadline?: Date } | null;
        if (!call?.deadline) continue;
        const due = remindersDue(
          { title: p.title, status: p.status, officialDeadline: call.deadline, internalDeadline: p.internalDeadline, reminders: p.reminders },
          now,
        );
        if (!due.length) continue;

        const people = await this.workers(p as unknown as Proposal);
        for (const d of due) {
          await Promise.all(
            people.map((recipientId) =>
              this.notifications.create({
                recipientId,
                type: NotificationType.PROPOSAL_REMINDER,
                message: d.message.slice(0, 300),
                entityType: 'proposal',
                entityId: p._id,
              }),
            ),
          );
          await this.proposalModel.updateOne({ _id: p._id }, { $set: { [`reminders.${d.key}`]: d.forDeadline } });
        }
      }

      const sections = await this.sectionModel
        .find({
          proposalId: { $in: [...active.keys()].map((k) => new Types.ObjectId(k)) },
          dueDate: { $gte: new Date(now.getTime() - DAY), $lte: new Date(now.getTime() + 3 * DAY) },
          status: { $ne: 'done' },
          ownerId: { $exists: true, $ne: null },
        })
        .lean();
      for (const s of sections) {
        if (!sectionReminderDue(s, now)) continue;
        const p = active.get(s.proposalId.toString())!;
        await this.notifications.create({
          recipientId: s.ownerId!,
          type: NotificationType.PROPOSAL_REMINDER,
          message: `"${s.title}" in "${p.title}" is due soon`.slice(0, 300),
          entityType: 'proposal',
          entityId: p._id,
        });
        await this.sectionModel.updateOne({ _id: s._id }, { $set: { dueRemindedFor: s.dueDate } });
      }
    } catch (err) {
      this.logger.error('Proposal reminders failed', err as Error);
    }
  }
}
