import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GrantsService } from './grants.service';

const id = () => new Types.ObjectId();
const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });
const select = <T>(value: T) => ({ select: () => lean(value) });

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

const dto = (over: Record<string, unknown> = {}) =>
  ({
    title: 'Early career grant',
    funder: 'Some Foundation',
    url: 'https://funder.example.org/call/1',
    description: 'A grant for early career researchers.',
    fundingType: 'project',
    deadline: FUTURE,
    ...over,
  }) as any;

function build(opts: { user?: Record<string, unknown> | null; existing?: boolean; call?: any } = {}) {
  const created: any[] = [];
  const callModel: any = {
    exists: jest.fn().mockResolvedValue(opts.existing ? { _id: id() } : null),
    create: jest.fn().mockImplementation(async (doc) => {
      created.push(doc);
      return { ...doc, _id: id() };
    }),
    findById: jest.fn(),
  };
  if (opts.call) {
    // a document with save(), as the review flow loads it
    const doc = { ...opts.call, save: jest.fn().mockResolvedValue(undefined) };
    callModel.findById.mockImplementation(() => {
      const p: any = Promise.resolve(doc);
      p.select = () => lean(doc);
      p.populate = () => lean(doc);
      return p;
    });
    callModel.__doc = doc;
  }
  const userModel: any = {
    findById: jest.fn().mockReturnValue(select(opts.user === undefined ? { status: 'active', role: 'user' } : opts.user)),
  };
  const notifications = { create: jest.fn() };
  const service = new GrantsService(callModel, {} as any, userModel, notifications as any, {} as any);
  return { service, callModel, created, notifications };
}

describe('GrantsService.submit', () => {
  it('stores a user submission as pending, so it stays hidden until approved', async () => {
    const { service, created } = build();
    await service.submit(String(id()), dto());
    expect(created[0]).toMatchObject({ status: 'pending', source: 'user' });
  });

  it('refuses users who have not confirmed their email', async () => {
    const { service } = build({ user: { status: 'pending' } });
    await expect(service.submit(String(id()), dto())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a deadline in the past and a duplicate official link', async () => {
    await expect(build().service.submit(String(id()), dto({ deadline: PAST }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(build({ existing: true }).service.submit(String(id()), dto())).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('GrantsService.create (admin)', () => {
  it('publishes straight away as open, with a last-checked date', async () => {
    const { service, created } = build();
    await service.create(String(id()), dto());
    expect(created[0]).toMatchObject({ status: 'open', source: 'admin' });
    expect(created[0].lastCheckedAt).toBeInstanceOf(Date);
  });

  it('files a call whose deadline already passed as closed', async () => {
    const { service, created } = build();
    await service.create(String(id()), dto({ deadline: PAST }));
    expect(created[0].status).toBe('closed');
  });

  it('rejects an amount whose minimum is above its maximum', async () => {
    const { service } = build();
    await expect(
      service.create(String(id()), dto({ amount: { min: 500, max: 100, currency: 'EUR' } })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GrantsService.review', () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    _id: id(),
    title: 'Pending call',
    status: 'pending',
    deadline: FUTURE,
    submittedBy: id(),
    ...over,
  });

  it('approving publishes the call and tells the submitter', async () => {
    const { service, callModel, notifications } = build({ call: pending() });
    await service.review(String(id()), String(id()), { decision: 'approve' });
    expect(callModel.__doc.status).toBe('open');
    expect(callModel.__doc.save).toHaveBeenCalled();
    expect(notifications.create.mock.calls[0][0].type).toBe('GRANT_SUBMISSION_APPROVED');
  });

  it('rejecting keeps it hidden, stores the note and tells the submitter', async () => {
    const { service, callModel, notifications } = build({ call: pending() });
    await service.review(String(id()), String(id()), { decision: 'reject', note: 'Not a funding call' });
    expect(callModel.__doc.status).toBe('rejected');
    expect(callModel.__doc.reviewNote).toBe('Not a funding call');
    expect(notifications.create.mock.calls[0][0].type).toBe('GRANT_SUBMISSION_REJECTED');
  });

  it('approving a call whose deadline passed meanwhile files it as closed', async () => {
    const { service, callModel } = build({ call: pending({ deadline: PAST }) });
    await service.review(String(id()), String(id()), { decision: 'approve' });
    expect(callModel.__doc.status).toBe('closed');
  });

  it('only pending submissions can be reviewed', async () => {
    const { service } = build({ call: pending({ status: 'open' }) });
    await expect(service.review(String(id()), String(id()), { decision: 'approve' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GrantsService.findOne visibility', () => {
  const stored = (status: string, submitter = id()) => ({ _id: id(), status, submittedBy: { _id: submitter }, title: 't' });

  function buildFind(call: any, user: Record<string, unknown>) {
    const callModel: any = {
      findById: () => ({ populate: () => lean(call) }),
    };
    const saveModel: any = { find: () => lean([]) };
    const userModel: any = { findById: () => select(user) };
    return new GrantsService(callModel, saveModel, userModel, {} as any, {} as any);
  }

  it('hides a pending call from everybody except its submitter and admins', async () => {
    const submitter = id();
    const call = stored('pending', submitter);
    await expect(buildFind(call, { role: 'user' }).findOne(String(id()), String(id()))).rejects.toBeInstanceOf(NotFoundException);
    await expect(buildFind(call, { role: 'user' }).findOne(String(id()), String(submitter))).resolves.toBeDefined();
    await expect(buildFind(call, { role: 'admin' }).findOne(String(id()), String(id()))).resolves.toBeDefined();
  });

  it('hides rejected calls too, and shows open ones to anyone', async () => {
    await expect(buildFind(stored('rejected'), { role: 'user' }).findOne(String(id()), String(id()))).rejects.toBeInstanceOf(NotFoundException);
    await expect(buildFind(stored('open'), { role: 'user' }).findOne(String(id()), String(id()))).resolves.toBeDefined();
  });
});
