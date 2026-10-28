import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProposalReviewsService } from './proposal-reviews.service';

const id = () => new Types.ObjectId();
const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

interface Opts {
  /** the caller's access to the proposal */
  access?: Partial<{ canManage: boolean; canWrite: boolean; isReviewer: boolean; reviewSectionIds: string[] }>;
  teammates?: { _id: Types.ObjectId; firstName: string; lastName: string }[];
  supervisors?: { _id: Types.ObjectId; firstName: string; lastName: string }[];
  section?: Record<string, unknown> | null;
  pendingExists?: boolean;
  review?: Record<string, unknown> | null;
  reviewsOnSection?: { reviewerId: Types.ObjectId; requestedBy: Types.ObjectId }[];
  hasTeam?: boolean;
}

function build(opts: Opts = {}) {
  const caller = id();
  const proposal: any = { _id: id(), title: 'The proposal', teamId: opts.hasTeam === false ? undefined : id() };
  const section: any = opts.section === null ? null : { _id: id(), title: 'Abstract', status: 'writing', ownerId: id(), ...opts.section };
  const access = { proposal, userId: String(caller), canManage: false, canWrite: true, isReviewer: false, reviewSectionIds: [], ...opts.access };

  const created: any[] = [];
  const reviewModel: any = {
    exists: jest.fn().mockResolvedValue(opts.pendingExists ? { _id: id() } : null),
    create: jest.fn().mockImplementation(async (d) => {
      const r = { _id: id(), ...d };
      created.push(r);
      return r;
    }),
    findOne: jest.fn().mockResolvedValue(opts.review === undefined ? null : opts.review && { save: jest.fn(), ...opts.review }),
    find: jest.fn().mockReturnValue({ select: () => lean(opts.reviewsOnSection ?? []) }),
  };
  const sectionModel: any = {
    findOne: jest.fn().mockResolvedValue(section),
    findById: jest.fn().mockResolvedValue(section),
  };
  const comments: any[] = [];
  const commentModel: any = {
    create: jest.fn().mockImplementation(async (d) => {
      comments.push(d);
      return { ...d, populate: async () => d };
    }),
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const memberModel: any = {
    find: jest.fn().mockReturnValue({ populate: () => lean((opts.teammates ?? []).map((u) => ({ userId: u }))) }),
  };
  const supervisionModel: any = {
    find: jest.fn().mockReturnValue({ populate: () => lean([{ supervisorIds: opts.supervisors ?? [] }]) }),
  };
  const proposals = {
    access: jest.fn().mockResolvedValue(access),
    setSectionStatus: jest.fn(),
  };
  const notifications = { create: jest.fn() };

  const service = new ProposalReviewsService(
    reviewModel, sectionModel, commentModel, memberModel, supervisionModel, proposals as any, notifications as any,
  );
  return { service, caller, proposal, section, created, comments, reviewModel, proposals, notifications };
}

const person = (first: string) => ({ _id: id(), firstName: first, lastName: 'X' });

describe('who can be asked to review', () => {
  it('lists teammates and supervisors, never the caller, each person once', async () => {
    const ann = person('Ann');
    const sam = person('Sam');
    const { service, caller, proposal } = build({ teammates: [ann], supervisors: [sam, ann] });
    const list = await service.candidates(String(proposal._id), String(caller));
    expect(list.map((c) => `${c.name}:${c.kind}`)).toEqual(['Ann X:teammate', 'Sam X:supervisor']);
  });

  it('offers only supervisors on a personal proposal', async () => {
    const sam = person('Sam');
    const { service, caller, proposal } = build({ hasTeam: false, teammates: [person('Nope')], supervisors: [sam] });
    const list = await service.candidates(String(proposal._id), String(caller));
    expect(list.map((c) => c.kind)).toEqual(['supervisor']);
  });

  it('is closed to people who can only read', async () => {
    const { service, caller, proposal } = build({ access: { canWrite: false } });
    await expect(service.candidates(String(proposal._id), String(caller))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('asking for a review', () => {
  it('asks a teammate: creates the request, moves the section to review and notifies them', async () => {
    const ann = person('Ann');
    const { service, caller, proposal, section, created, proposals, notifications } = build({ teammates: [ann] });
    await service.request(String(proposal._id), String(section._id), String(caller), { reviewerId: String(ann._id), note: 'Check the aims' });
    expect(created[0].note).toBe('Check the aims');
    expect(proposals.setSectionStatus).toHaveBeenCalledWith(proposal, section, 'review', String(caller));
    expect(notifications.create.mock.calls[0][0].type).toBe('PROPOSAL_REVIEW_REQUESTED');
    expect(String(notifications.create.mock.calls[0][0].recipientId)).toBe(String(ann._id));
  });

  it('leaves a finished section as it is', async () => {
    const ann = person('Ann');
    const { service, caller, proposal, section, proposals } = build({ teammates: [ann], section: { status: 'done' } });
    await service.request(String(proposal._id), String(section._id), String(caller), { reviewerId: String(ann._id) });
    expect(proposals.setSectionStatus).not.toHaveBeenCalled();
  });

  it('refuses yourself, strangers, and a second pending request for the same person', async () => {
    const ann = person('Ann');
    const a = build({ teammates: [ann] });
    await expect(a.service.request(String(a.proposal._id), String(a.section._id), String(a.caller), { reviewerId: String(a.caller) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(a.service.request(String(a.proposal._id), String(a.section._id), String(a.caller), { reviewerId: String(id()) })).rejects.toBeInstanceOf(BadRequestException);

    const b = build({ teammates: [ann], pendingExists: true });
    await expect(b.service.request(String(b.proposal._id), String(b.section._id), String(b.caller), { reviewerId: String(ann._id) })).rejects.toBeInstanceOf(ConflictException);
  });

  it('is closed to readers', async () => {
    const ann = person('Ann');
    const { service, caller, proposal, section } = build({ teammates: [ann], access: { canWrite: false } });
    await expect(service.request(String(proposal._id), String(section._id), String(caller), { reviewerId: String(ann._id) })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('answering a review', () => {
  const pending = (reviewer: Types.ObjectId, requester = id()) => ({
    _id: id(), reviewerId: reviewer, requestedBy: requester, sectionId: id(), status: 'pending',
  });

  it('approving records the answer and tells the requester', async () => {
    const reviewer = id();
    const review: any = pending(reviewer);
    const { service, proposal, notifications, proposals } = build({ review });
    const result: any = await service.respond(String(proposal._id), String(review._id), String(reviewer), { decision: 'approve', response: 'Looks good' });
    expect(result.status).toBe('approved');
    expect(result.response).toBe('Looks good');
    expect(notifications.create.mock.calls[0][0].type).toBe('PROPOSAL_REVIEW_DONE');
    expect(String(notifications.create.mock.calls[0][0].recipientId)).toBe(String(review.requestedBy));
    expect(proposals.setSectionStatus).not.toHaveBeenCalled();
  });

  it('requesting changes sends a section in review back to writing', async () => {
    const reviewer = id();
    const review: any = pending(reviewer);
    const { service, proposal, proposals } = build({ review, section: { status: 'review' } });
    const result: any = await service.respond(String(proposal._id), String(review._id), String(reviewer), { decision: 'changes' });
    expect(result.status).toBe('changes_requested');
    expect(proposals.setSectionStatus.mock.calls[0][2]).toBe('writing');
  });

  it('only the reviewer can answer; for everybody else the request does not exist', async () => {
    const review: any = pending(id());
    const { service, proposal } = build({ review });
    await expect(service.respond(String(proposal._id), String(review._id), String(id()), { decision: 'approve' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cannot be answered twice', async () => {
    const reviewer = id();
    const review: any = { ...pending(reviewer), status: 'approved' };
    const { service, proposal } = build({ review });
    await expect(service.respond(String(proposal._id), String(review._id), String(reviewer), { decision: 'approve' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('can be cancelled by whoever asked, or a manager, while pending', async () => {
    const requester = id();
    const review: any = pending(id(), requester);
    const own = build({ review: { ...review }, access: { canManage: false } });
    own.proposals.access.mockResolvedValue({ proposal: own.proposal, userId: String(requester), canManage: false, canWrite: true, isReviewer: false, reviewSectionIds: [] });
    await expect(own.service.cancel(String(own.proposal._id), String(review._id), String(requester))).resolves.toMatchObject({ status: 'cancelled' });

    const other = build({ review: { ...review }, access: { canManage: false } });
    await expect(other.service.cancel(String(other.proposal._id), String(review._id), String(other.caller))).rejects.toBeInstanceOf(ForbiddenException);

    const manager = build({ review: { ...review }, access: { canManage: true } });
    await expect(manager.service.cancel(String(manager.proposal._id), String(review._id), String(manager.caller))).resolves.toMatchObject({ status: 'cancelled' });

    const done = build({ review: { ...review, status: 'approved' }, access: { canManage: true } });
    await expect(done.service.cancel(String(done.proposal._id), String(review._id), String(done.caller))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('comments', () => {
  it('writers can comment on any section; viewers cannot', async () => {
    const writer = build();
    await expect(writer.service.addComment(String(writer.proposal._id), String(writer.section._id), String(writer.caller), { body: 'Hi' })).resolves.toBeDefined();
    const viewer = build({ access: { canWrite: false } });
    await expect(viewer.service.addComment(String(viewer.proposal._id), String(viewer.section._id), String(viewer.caller), { body: 'Hi' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a reviewer can comment only on the sections they were asked about', async () => {
    const mine = build({ access: { canWrite: false, isReviewer: true, reviewSectionIds: [] } });
    mine.proposals.access.mockResolvedValue({ proposal: mine.proposal, userId: String(mine.caller), canManage: false, canWrite: false, isReviewer: true, reviewSectionIds: [String(mine.section._id)] });
    await expect(mine.service.addComment(String(mine.proposal._id), String(mine.section._id), String(mine.caller), { body: 'Fix the aims' })).resolves.toBeDefined();

    const other = build({ access: { canWrite: false, isReviewer: true, reviewSectionIds: [String(id())] } });
    await expect(other.service.addComment(String(other.proposal._id), String(other.section._id), String(other.caller), { body: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('notifies the section owner and the people on its reviews, not the author', async () => {
    const owner = id();
    const reviewer = id();
    const requester = id();
    const { service, proposal, section, caller, notifications } = build({
      section: { ownerId: owner },
      reviewsOnSection: [{ reviewerId: reviewer, requestedBy: requester }],
    });
    await service.addComment(String(proposal._id), String(section._id), String(caller), { body: 'Thoughts?' });
    const recipients = notifications.create.mock.calls.map((c) => String(c[0].recipientId)).sort();
    expect(recipients).toEqual([String(owner), String(reviewer), String(requester)].sort());
    expect(notifications.create.mock.calls[0][0].type).toBe('PROPOSAL_COMMENT');
  });

  it('does not notify the author of their own comment', async () => {
    const author = id();
    const { service, proposal, section, proposals, notifications } = build({ section: { ownerId: author } });
    proposals.access.mockResolvedValue({ proposal, userId: String(author), canManage: false, canWrite: true, isReviewer: false, reviewSectionIds: [] });
    await service.addComment(String(proposal._id), String(section._id), String(author), { body: 'Note to self' });
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
