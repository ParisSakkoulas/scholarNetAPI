import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProposalsService, applyOutcomeDates } from './proposals.service';

const id = () => new Types.ObjectId();
const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('applyOutcomeDates', () => {
  const NOW = new Date('2026-06-01T10:00:00Z');

  it('stamps the submission date when a proposal is marked submitted', () => {
    const p: any = { status: 'submitted' };
    applyOutcomeDates(p, NOW);
    expect(p.submittedAt).toEqual(NOW);
    expect(p.decidedAt).toBeUndefined();
  });

  it('stamps the decision date on awarded and not funded, keeping the earlier submission date', () => {
    const earlier = new Date('2026-03-01');
    const awarded: any = { status: 'awarded', submittedAt: earlier };
    applyOutcomeDates(awarded, NOW);
    expect(awarded.submittedAt).toEqual(earlier);
    expect(awarded.decidedAt).toEqual(NOW);

    const rejected: any = { status: 'rejected' };
    applyOutcomeDates(rejected, NOW);
    expect(rejected.submittedAt).toEqual(NOW);
    expect(rejected.decidedAt).toEqual(NOW);
  });

  it('clears both dates when the proposal goes back to work', () => {
    const p: any = { status: 'writing', submittedAt: NOW, decidedAt: NOW };
    applyOutcomeDates(p);
    expect(p.submittedAt).toBeUndefined();
    expect(p.decidedAt).toBeUndefined();
  });
});

describe('ProposalsService: reviewers and history', () => {
  function build(opts: { member?: unknown; reviewSections?: number[]; proposals?: any[] } = {}) {
    const proposal: any = {
      _id: id(), callId: id(), ownerId: id(), teamId: id(), title: 'P', status: 'writing',
      save: jest.fn(), deleteOne: jest.fn(),
    };
    const proposalModel: any = {
      findById: jest.fn().mockImplementation(() => {
        const p: any = Promise.resolve(proposal);
        p.populate = () => ({ populate: () => lean({ ...proposal }) });
        return p;
      }),
      find: jest.fn().mockImplementation(() => {
        const chain: any = { populate: () => chain, sort: () => chain, lean: () => Promise.resolve(opts.proposals ?? []) };
        return chain;
      }),
    };
    const sections = [{ _id: id(), proposalId: proposal._id, title: 'Aims' }, { _id: id(), proposalId: proposal._id, title: 'Budget' }];
    const sectionModel: any = {
      find: jest.fn().mockImplementation((q: any) => {
        const wanted = q._id?.$in?.map(String);
        const rows = wanted ? sections.filter((s) => wanted.includes(String(s._id))) : sections;
        const chain: any = { sort: () => chain, populate: () => chain, lean: () => Promise.resolve(rows) };
        return chain;
      }),
    };
    const listChain = (rows: any[]) => {
      const chain: any = { sort: () => chain, populate: () => chain, lean: () => Promise.resolve(rows) };
      return chain;
    };
    const fileModel: any = {
      find: jest.fn().mockReturnValue(listChain([])),
      findOne: jest.fn(),
    };
    const reviewModel: any = {
      find: jest.fn().mockImplementation((q: any) =>
        q.reviewerId ? { select: () => lean((opts.reviewSections ?? []).map((i) => ({ sectionId: sections[i]._id }))) } : listChain([]),
      ),
    };
    const memberModel: any = { findOne: jest.fn().mockReturnValue(lean(opts.member ?? null)) };

    const service = new ProposalsService(
      proposalModel, sectionModel, fileModel, {} as any, memberModel, {} as any, {} as any, {} as any,
      reviewModel, {} as any, {} as any, { create: jest.fn() } as any, { delete: jest.fn() } as any, { get: () => undefined } as any,
    );
    return { service, proposal, sections, fileModel };
  }

  it('lets a reviewer in, but only to the sections they were asked about', async () => {
    const { service, proposal } = build({ reviewSections: [1] });
    const view: any = await service.get(String(proposal._id), String(id()));
    expect(view.access).toEqual({ canManage: false, canWrite: false, isReviewer: true });
    expect(view.sections.map((s: any) => s.title)).toEqual(['Budget']);
  });

  it('a reviewer cannot change anything', async () => {
    const { service, proposal, sections } = build({ reviewSections: [0] });
    await expect(service.update(String(proposal._id), String(id()), { title: 'New' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateSection(String(proposal._id), String(sections[0]._id), String(id()), { status: 'done' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('somebody with no review and no seat on the team still gets a 404', async () => {
    const { service, proposal } = build();
    await expect(service.get(String(proposal._id), String(id()))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a reviewer can download drafts of their section, and no others', async () => {
    const { service, proposal, sections, fileModel } = build({ reviewSections: [0] });
    const draftOf = (sectionId: Types.ObjectId) => ({ select: () => lean({ _id: id(), sectionId, storageKey: 'k', fileName: 'f.pdf', mimeType: 'application/pdf', size: 1 }) });

    fileModel.findOne.mockReturnValue(draftOf(sections[1]._id));
    await expect(service.openFile(String(proposal._id), String(id()), String(id()))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('summarises a track record: totals, submitted, awarded and a success rate over answered ones', async () => {
    const rows = [
      { _id: id(), status: 'awarded', title: 'A', callId: { funder: 'F1' }, decidedAt: new Date(), outcomeNote: 'Great' },
      { _id: id(), status: 'rejected', title: 'B', callId: { funder: 'F2' }, decidedAt: new Date() },
      { _id: id(), status: 'rejected', title: 'C', callId: { funder: 'F3' }, decidedAt: new Date() },
      { _id: id(), status: 'submitted', title: 'D', callId: { funder: 'F4' } },
      { _id: id(), status: 'writing', title: 'E', callId: { funder: 'F5' } },
      { _id: id(), status: 'planning', title: 'F', callId: { funder: 'F6' } },
    ];
    const { service } = build({ proposals: rows });
    const h = await service.history(String(id()));
    expect(h).toMatchObject({ total: 6, active: 2, submitted: 4, awaiting: 1, awarded: 1, notFunded: 2, successRate: 33 });
    expect(h.decidedProposals.map((p) => p.title)).toEqual(['A', 'B', 'C']);
    expect(h.decidedProposals[0].funder).toBe('F1');
  });

  it('has no success rate until a proposal was answered', async () => {
    const { service } = build({ proposals: [{ _id: id(), status: 'submitted', title: 'D', callId: {} }] });
    expect((await service.history(String(id()))).successRate).toBeNull();
  });
});
