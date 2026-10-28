import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProposalsService } from './proposals.service';

const id = () => new Types.ObjectId();
const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });
const DAY = 24 * 60 * 60 * 1000;

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('x'.repeat(50))]);
const upload = (over: Record<string, unknown> = {}) =>
  ({ originalname: 'draft.pdf', buffer: PDF, size: PDF.length, ...over }) as any;

interface Opts {
  /** the caller's row in the team, or null for "not a member" */
  member?: { role: string } | null;
  proposal?: Record<string, unknown> | null;
  call?: Record<string, unknown> | null;
  clash?: boolean;
  section?: Record<string, unknown> | null;
  workers?: Types.ObjectId[];
}

function build(opts: Opts = {}) {
  const caller = id();
  const team = id();
  const call = opts.call === undefined
    ? { _id: id(), title: 'ML call', funder: 'F', status: 'open', deadline: new Date(Date.now() + 30 * DAY) }
    : opts.call;
  const proposal: any = opts.proposal === null
    ? null
    : {
        _id: id(), callId: call?._id, ownerId: id(), teamId: team, title: 'P', status: 'planning',
        save: jest.fn().mockResolvedValue(undefined), deleteOne: jest.fn(), ...opts.proposal,
      };
  const section: any = opts.section === null
    ? null
    : { _id: id(), proposalId: proposal?._id, title: 'Abstract', status: 'todo', fileIds: [], save: jest.fn(), deleteOne: jest.fn(), ...opts.section };

  const created: any[] = [];
  const proposalModel: any = {
    findById: jest.fn().mockResolvedValue(proposal),
    exists: jest.fn().mockResolvedValue(opts.clash ? { _id: id() } : null),
    create: jest.fn().mockImplementation(async (d) => {
      const doc: any = { _id: id(), ...d, save: jest.fn(), deleteOne: jest.fn() };
      created.push(doc);
      return doc;
    }),
  };
  const sectionModel: any = {
    findOne: jest.fn().mockImplementation((q: any) => (q._id ? Promise.resolve(section) : { sort: () => lean(null) })),
    insertMany: jest.fn().mockImplementation(async (docs) => docs.map((d: any) => ({ _id: id(), ...d, status: 'todo', save: jest.fn() }))),
    create: jest.fn().mockImplementation(async (d) => ({ _id: id(), status: 'todo', ...d, save: jest.fn() })),
    updateOne: jest.fn(),
    deleteMany: jest.fn(),
  };
  const fileModel: any = {
    create: jest.fn().mockImplementation(async (d) => ({ _id: id(), ...d, toObject: () => ({ ...d }) })),
    find: jest.fn().mockReturnValue({ select: () => lean([]) }),
    deleteMany: jest.fn(),
  };
  const callModel: any = {
    findById: jest.fn().mockImplementation(() => ({ lean: () => Promise.resolve(call), select: () => lean(call) })),
  };
  const memberModel: any = {
    findOne: jest.fn().mockReturnValue(lean(opts.member === undefined ? { role: 'member' } : opts.member)),
    find: jest.fn().mockReturnValue({ select: () => lean((opts.workers ?? [caller]).map((u) => ({ userId: u }))) }),
  };
  const taskModel: any = { deleteMany: jest.fn(), deleteOne: jest.fn() };
  const projects = { create: jest.fn().mockResolvedValue({ _id: id() }) };
  const notifications = { create: jest.fn() };
  const storage = { save: jest.fn(), delete: jest.fn(), read: jest.fn() };
  const boardModel: any = { findOne: jest.fn().mockReturnValue(lean(null)) };
  // nobody has been asked to review anything by default
  const reviewModel: any = { find: jest.fn().mockReturnValue({ select: () => lean([]) }) };
  const columnModel: any = { find: jest.fn().mockReturnValue({ sort: () => lean([]) }) };

  const service = new ProposalsService(
    proposalModel, sectionModel, fileModel, callModel, memberModel, taskModel, columnModel, boardModel,
    reviewModel, {} as any, projects as any, notifications as any, storage as any, { get: () => undefined } as any,
  );
  return { service, caller, team, call, proposal, section, created, projects, notifications, storage, sectionModel, fileModel, proposalModel, memberModel };
}

describe('ProposalsService access', () => {
  it('hides a team proposal from people outside the team', async () => {
    const { service, caller, proposal } = build({ member: null });
    await expect(service.get(String(proposal._id), String(caller))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a personal proposal from everybody but its owner', async () => {
    const { service, proposal } = build({ proposal: { teamId: undefined } });
    await expect(service.get(String(proposal._id), String(id()))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets plain members write but not manage; viewers only read', async () => {
    const member = build({ member: { role: 'member' } });
    const a = await member.service.access(String(member.proposal._id), String(member.caller));
    expect([a.canManage, a.canWrite]).toEqual([false, true]);

    const viewer = build({ member: { role: 'viewer' } });
    const v = await viewer.service.access(String(viewer.proposal._id), String(viewer.caller));
    expect([v.canManage, v.canWrite]).toEqual([false, false]);

    const admin = build({ member: { role: 'admin' } });
    const m = await admin.service.access(String(admin.proposal._id), String(admin.caller));
    expect([m.canManage, m.canWrite]).toEqual([true, true]);
  });

  it('lets the proposal owner manage even as a plain member', async () => {
    const owner = id();
    const { service, proposal } = build({ member: { role: 'member' }, proposal: { ownerId: owner } });
    expect((await service.access(String(proposal._id), String(owner))).canManage).toBe(true);
  });

  it('only owners and admins can change settings or delete', async () => {
    const { service, proposal, caller } = build({ member: { role: 'member' } });
    await expect(service.update(String(proposal._id), String(caller), { title: 'New' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(String(proposal._id), String(caller))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('viewers cannot touch sections or files', async () => {
    const { service, proposal, section, caller } = build({ member: { role: 'viewer' } });
    await expect(service.updateSection(String(proposal._id), String(section._id), String(caller), { status: 'done' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.uploadFile(String(proposal._id), String(section._id), String(caller), upload())).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ProposalsService.start', () => {
  it('creates a personal proposal with the six default sections and no board', async () => {
    const { service, caller, call, sectionModel, projects } = build();
    const proposal = await service.start(String(caller), String(call!._id), {});
    expect(proposal.title).toBe('ML call');
    expect(sectionModel.insertMany.mock.calls[0][0].map((s: any) => s.title)).toEqual([
      'Abstract', 'Work plan', 'Budget', 'CV', 'Ethics statement', 'Letters of support',
    ]);
    expect(projects.create).not.toHaveBeenCalled();
  });

  it('creates a Kanban project for a team proposal', async () => {
    const { service, caller, call, team, projects } = build({ member: { role: 'member' } });
    await service.start(String(caller), String(call!._id), { teamId: String(team) });
    expect(projects.create).toHaveBeenCalledTimes(1);
    expect(projects.create.mock.calls[0][0]).toBe(String(team));
  });

  it('refuses viewers and non-members for a team proposal', async () => {
    for (const member of [{ role: 'viewer' }, null]) {
      const { service, caller, call, team } = build({ member });
      await expect(service.start(String(caller), String(call!._id), { teamId: String(team) })).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('refuses a second proposal for the same call', async () => {
    const { service, caller, call } = build({ clash: true });
    await expect(service.start(String(caller), String(call!._id), {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('only works on open calls with a deadline ahead', async () => {
    const closed = build({ call: { _id: id(), title: 'x', funder: 'f', status: 'closed', deadline: new Date(Date.now() - DAY) } });
    await expect(closed.service.start(String(closed.caller), String(closed.call!._id), {})).rejects.toBeInstanceOf(BadRequestException);
    const pending = build({ call: { _id: id(), title: 'x', funder: 'f', status: 'pending', deadline: new Date(Date.now() + DAY) } });
    await expect(pending.service.start(String(pending.caller), String(pending.call!._id), {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the internal deadline before the funder deadline', async () => {
    const { service, caller, call } = build();
    await expect(
      service.start(String(caller), String(call!._id), { internalDeadline: new Date(Date.now() + 40 * DAY) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProposalsService sections', () => {
  const official = new Date(Date.now() + 10 * DAY);

  it('rejects a section due after the funder deadline', async () => {
    const { service, proposal, section, caller } = build({ member: { role: 'admin' }, call: { _id: id(), title: 'x', funder: 'f', status: 'open', deadline: official } });
    await expect(
      service.updateSection(String(proposal._id), String(section._id), String(caller), { dueDate: new Date(Date.now() + 20 * DAY) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets only managers assign a section, and only to people on the proposal', async () => {
    const plain = build({ member: { role: 'member' } });
    await expect(
      plain.service.updateSection(String(plain.proposal._id), String(plain.section._id), String(plain.caller), { ownerId: String(id()) }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const outsider = id();
    const manager = build({ member: { role: 'admin' } });
    await expect(
      manager.service.updateSection(String(manager.proposal._id), String(manager.section._id), String(manager.caller), { ownerId: String(outsider) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('assigns a team member and notifies them', async () => {
    const worker = id();
    const { service, proposal, section, caller, notifications } = build({ member: { role: 'admin' }, workers: [worker] });
    await service.updateSection(String(proposal._id), String(section._id), String(caller), { ownerId: String(worker) });
    expect(section.ownerId.toString()).toBe(worker.toString());
    expect(notifications.create.mock.calls[0][0].type).toBe('PROPOSAL_SECTION_ASSIGNED');
  });

  it('lets a plain member change a section status', async () => {
    const { service, proposal, section, caller } = build({ member: { role: 'member' } });
    await service.updateSection(String(proposal._id), String(section._id), String(caller), { status: 'writing' });
    expect(section.status).toBe('writing');
    expect(section.save).toHaveBeenCalled();
  });
});

describe('ProposalsService files', () => {
  it('stores an accepted draft and links it to the section', async () => {
    const { service, proposal, section, caller, storage, sectionModel } = build({ member: { role: 'member' } });
    const view: any = await service.uploadFile(String(proposal._id), String(section._id), String(caller), upload());
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.save.mock.calls[0][0]).toMatch(/^proposals\/.+\.pdf$/);
    expect(sectionModel.updateOne.mock.calls[0][1].$push.fileIds).toBeDefined();
    expect(view.storageKey).toBeUndefined(); // the storage key never leaves the server
  });

  it('refuses files whose content does not match the extension, and other types', async () => {
    const { service, proposal, section, caller, storage } = build({ member: { role: 'member' } });
    const args = [String(proposal._id), String(section._id), String(caller)] as const;
    await expect(service.uploadFile(...args, upload({ buffer: Buffer.from('not a pdf at all') }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.uploadFile(...args, upload({ originalname: 'run.exe' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.uploadFile(...args, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('refuses an eleventh file in a section', async () => {
    const { service, proposal, section, caller } = build({
      member: { role: 'member' },
      section: { fileIds: Array.from({ length: 10 }, () => id()) },
    });
    await expect(service.uploadFile(String(proposal._id), String(section._id), String(caller), upload())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes the stored file again when saving its record fails', async () => {
    const { service, proposal, section, caller, storage, fileModel } = build({ member: { role: 'member' } });
    fileModel.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.uploadFile(String(proposal._id), String(section._id), String(caller), upload())).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});
