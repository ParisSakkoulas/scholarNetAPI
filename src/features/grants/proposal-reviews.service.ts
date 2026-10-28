import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { TeamMember } from '../teams/schema/team-member.schema';
import { Supervision } from '../supervisions/schemas/supervision.schema';
import { Comment } from '../tasks/schema/comment.schema';
import { ProposalSection } from './schemas/proposal-section.schema';
import { ProposalReview } from './schemas/proposal-review.schema';
import { CommentDto, RequestReviewDto, RespondReviewDto } from './dto/proposal.dto';
import { ProposalAccess, ProposalsService } from './proposals.service';

const PERSON_FIELDS = 'username firstName lastName profilePhotoUrl';
export const SECTION_COMMENT = 'proposal_section';

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
  return new Types.ObjectId(id);
};

const nameOf = (u?: { firstName?: string; lastName?: string; username?: string } | null) =>
  `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || u?.username || '';

export interface ReviewerCandidate {
  userId: string;
  name: string;
  /** Where the right to review comes from. */
  kind: 'teammate' | 'supervisor';
}

/**
 * Asking someone to look at a section, and the comments that go with it. A reviewer can read the
 * sections they were asked about (and download their drafts), comment, and answer; nothing more.
 */
@Injectable()
export class ProposalReviewsService {
  constructor(
    @InjectModel(ProposalReview.name) private reviewModel: Model<ProposalReview>,
    @InjectModel(ProposalSection.name) private sectionModel: Model<ProposalSection>,
    @InjectModel(Comment.name) private commentModel: Model<Comment>,
    @InjectModel(TeamMember.name) private memberModel: Model<TeamMember>,
    @InjectModel(Supervision.name) private supervisionModel: Model<Supervision>,
    private proposals: ProposalsService,
    private notifications: NotificationsService,
  ) {}

  // ---------------- who can be asked ----------------

  /** Teammates, plus the caller's active supervisors. Nobody else, so review requests cannot be used to spam. */
  async candidates(id: string, userId: string): Promise<ReviewerCandidate[]> {
    const a = await this.proposals.access(id, userId);
    this.assertWrite(a);
    return this.candidatesFor(a, userId);
  }

  private async candidatesFor(a: ProposalAccess, userId: string): Promise<ReviewerCandidate[]> {
    const found = new Map<string, ReviewerCandidate>();

    if (a.proposal.teamId) {
      const members = await this.memberModel
        .find({ teamId: a.proposal.teamId, status: 'active' })
        .populate('userId', PERSON_FIELDS)
        .lean();
      for (const m of members) {
        const u = m.userId as any;
        if (u?._id && u._id.toString() !== userId) {
          found.set(u._id.toString(), { userId: u._id.toString(), name: nameOf(u), kind: 'teammate' });
        }
      }
    }

    const supervisions = await this.supervisionModel
      .find({ studentId: new Types.ObjectId(userId), status: 'active' })
      .populate('supervisorIds', PERSON_FIELDS)
      .lean();
    for (const s of supervisions) {
      for (const sup of s.supervisorIds as any[]) {
        if (sup?._id && sup._id.toString() !== userId && !found.has(sup._id.toString())) {
          found.set(sup._id.toString(), { userId: sup._id.toString(), name: nameOf(sup), kind: 'supervisor' });
        }
      }
    }
    return [...found.values()].sort((x, y) => x.name.localeCompare(y.name));
  }

  private assertWrite(a: ProposalAccess) {
    if (!a.canWrite) throw new ForbiddenException('You can only read this proposal');
  }

  // ---------------- review requests ----------------

  async request(id: string, sectionId: string, userId: string, dto: RequestReviewDto) {
    const a = await this.proposals.access(id, userId);
    this.assertWrite(a);
    const section = await this.sectionModel.findOne({ _id: oid(sectionId), proposalId: a.proposal._id });
    if (!section) throw new NotFoundException('Section not found');

    if (dto.reviewerId === userId) throw new BadRequestException('You cannot review your own section');
    const candidates = await this.candidatesFor(a, userId);
    const reviewer = candidates.find((c) => c.userId === dto.reviewerId);
    if (!reviewer) {
      throw new BadRequestException('You can ask your teammates and your supervisors to review a section');
    }

    const open = await this.reviewModel.exists({ sectionId: section._id, reviewerId: oid(dto.reviewerId), status: 'pending' });
    if (open) throw new ConflictException('This person already has a pending review request for this section');

    const review = await this.reviewModel.create({
      proposalId: a.proposal._id,
      sectionId: section._id,
      requestedBy: new Types.ObjectId(userId),
      reviewerId: oid(dto.reviewerId),
      note: dto.note || undefined,
    });

    // a section out for review is, by definition, in review
    if (section.status === 'todo' || section.status === 'writing') {
      await this.proposals.setSectionStatus(a.proposal, section, 'review', userId);
    }

    await this.notifications.create({
      recipientId: dto.reviewerId,
      actorId: userId,
      type: NotificationType.PROPOSAL_REVIEW_REQUESTED,
      message: `You were asked to review "${section.title}" in "${a.proposal.title}"`.slice(0, 300),
      entityType: 'proposal',
      entityId: a.proposal._id as Types.ObjectId,
    });
    return review;
  }

  async respond(id: string, reviewId: string, userId: string, dto: RespondReviewDto) {
    const review = await this.reviewModel.findOne({ _id: oid(reviewId), proposalId: oid(id) });
    // only the reviewer can answer; everybody else is told the request does not exist
    if (!review || review.reviewerId.toString() !== userId) throw new NotFoundException('Review request not found');
    if (review.status !== 'pending') throw new BadRequestException('This review was already answered or cancelled');

    const a = await this.proposals.access(id, userId);
    const section = await this.sectionModel.findById(review.sectionId);
    if (!section) throw new NotFoundException('Section not found');

    const approve = dto.decision === 'approve';
    review.status = approve ? 'approved' : 'changes_requested';
    review.response = dto.response || undefined;
    review.respondedAt = new Date();
    await review.save();

    // changes requested sends the section back to its writer
    if (!approve && section.status === 'review') {
      await this.proposals.setSectionStatus(a.proposal, section, 'writing', userId);
    }

    await this.notifications.create({
      recipientId: review.requestedBy,
      actorId: userId,
      type: NotificationType.PROPOSAL_REVIEW_DONE,
      message: `${approve ? 'Approved' : 'Changes requested on'} "${section.title}" in "${a.proposal.title}"${dto.response ? `: ${dto.response}` : ''}`.slice(0, 300),
      entityType: 'proposal',
      entityId: a.proposal._id as Types.ObjectId,
    });
    return review;
  }

  async cancel(id: string, reviewId: string, userId: string) {
    const a = await this.proposals.access(id, userId);
    const review = await this.reviewModel.findOne({ _id: oid(reviewId), proposalId: a.proposal._id });
    if (!review) throw new NotFoundException('Review request not found');
    if (review.requestedBy.toString() !== userId && !a.canManage) {
      throw new ForbiddenException('Only whoever asked, or a manager, can cancel a review request');
    }
    if (review.status !== 'pending') throw new BadRequestException('Only pending requests can be cancelled');
    review.status = 'cancelled';
    await review.save();
    return review;
  }

  /** Reviews waiting for the caller, across every proposal. */
  async mine(userId: string) {
    const reviews = await this.reviewModel
      .find({ reviewerId: new Types.ObjectId(userId), status: 'pending' })
      .sort({ createdAt: -1 })
      .populate('proposalId', 'title')
      .populate('sectionId', 'title')
      .populate('requestedBy', PERSON_FIELDS)
      .lean();
    return reviews.filter((r) => r.proposalId && r.sectionId);
  }

  /** Reviews of every section of a proposal, grouped for the page. */
  async forProposal(proposalId: Types.ObjectId, onlySections?: string[]) {
    const filter: Record<string, unknown> = { proposalId, status: { $ne: 'cancelled' } };
    if (onlySections) filter.sectionId = { $in: onlySections.map((s) => new Types.ObjectId(s)) };
    return this.reviewModel
      .find(filter)
      .sort({ createdAt: 1 })
      .populate('reviewerId', PERSON_FIELDS)
      .populate('requestedBy', PERSON_FIELDS)
      .lean();
  }

  // ---------------- comments ----------------

  /** Writers can comment on any section; a reviewer only on the sections they were asked about. */
  private assertCanComment(a: ProposalAccess, sectionId: string, write: boolean) {
    if (a.isReviewer) {
      if (!a.reviewSectionIds.includes(sectionId)) throw new NotFoundException('Section not found');
      return;
    }
    if (write && !a.canWrite) throw new ForbiddenException('Viewers can read comments but not write them');
  }

  async listComments(id: string, sectionId: string, userId: string) {
    const a = await this.proposals.access(id, userId);
    await this.sectionOf(a, sectionId);
    this.assertCanComment(a, sectionId, false);
    return this.commentModel
      .find({ entityType: SECTION_COMMENT, entityId: oid(sectionId) })
      .sort({ createdAt: 1 })
      .populate('authorId', PERSON_FIELDS)
      .lean();
  }

  async addComment(id: string, sectionId: string, userId: string, dto: CommentDto) {
    const a = await this.proposals.access(id, userId);
    const section = await this.sectionOf(a, sectionId);
    this.assertCanComment(a, sectionId, true);

    const comment = await this.commentModel.create({
      entityType: SECTION_COMMENT,
      entityId: section._id,
      authorId: new Types.ObjectId(userId),
      body: dto.body,
    });

    // tell the other side: the section's owner and everyone with a review on it
    const reviews = await this.reviewModel
      .find({ sectionId: section._id, status: { $ne: 'cancelled' } })
      .select('reviewerId requestedBy')
      .lean();
    const recipients = new Set<string>();
    if (section.ownerId) recipients.add(section.ownerId.toString());
    for (const r of reviews) {
      recipients.add(r.reviewerId.toString());
      recipients.add(r.requestedBy.toString());
    }
    recipients.delete(userId);
    await Promise.all(
      [...recipients].map((recipientId) =>
        this.notifications.create({
          recipientId,
          actorId: userId,
          type: NotificationType.PROPOSAL_COMMENT,
          message: `New comment on "${section.title}" in "${a.proposal.title}"`.slice(0, 300),
          entityType: 'proposal',
          entityId: a.proposal._id as Types.ObjectId,
        }),
      ),
    );
    return comment.populate('authorId', PERSON_FIELDS);
  }

  async removeComment(id: string, commentId: string, userId: string) {
    const a = await this.proposals.access(id, userId);
    const comment = await this.commentModel.findOne({ _id: oid(commentId), entityType: SECTION_COMMENT });
    if (!comment) throw new NotFoundException('Comment not found');
    // the comment must belong to a section of this proposal
    await this.sectionOf(a, comment.entityId.toString());
    if (comment.authorId.toString() !== userId && !a.canManage) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await comment.deleteOne();
    return { deleted: true };
  }

  private async sectionOf(a: ProposalAccess, sectionId: string) {
    const section = await this.sectionModel.findOne({ _id: oid(sectionId), proposalId: a.proposal._id });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }
}
