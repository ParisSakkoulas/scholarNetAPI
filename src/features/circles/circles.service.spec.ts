import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CirclesService } from './circles.service';
import { CircleSessionsService } from './circle-sessions.service';

const id = () => new Types.ObjectId();
const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('CirclesService.join', () => {
  const circle = (over: Record<string, unknown> = {}) => ({
    _id: id(),
    ownerId: id(),
    name: 'Thesis Tuesdays',
    status: 'active',
    visibility: 'public',
    maxMembers: 2,
    ...over,
  });

  function build(c: ReturnType<typeof circle>, seats: number, existing: unknown = null) {
    const circleModel = { findById: jest.fn().mockResolvedValue(c) };
    const memberModel = {
      findOne: jest.fn().mockResolvedValue(existing),
      countDocuments: jest.fn().mockResolvedValue(seats),
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: id() }),
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ select: () => lean([]) }),
    };
    const notifications = { create: jest.fn() };
    const service = new CirclesService(
      circleModel as any,
      memberModel as any,
      {} as any,
      {} as any,
      { findById: () => ({ select: () => lean({ username: 'sam' }) }) } as any,
      {} as any,
      notifications as any,
    );
    return { service, memberModel, notifications };
  }

  it('refuses to join a full circle with a clear error', async () => {
    const { service, memberModel } = build(circle(), 2);
    await expect(service.join(String(id()), String(id()))).rejects.toThrow(
      new ConflictException('This circle is full'),
    );
    expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('lets someone take the last seat', async () => {
    const { service, memberModel } = build(circle(), 1);
    // the recount after writing must also fit
    memberModel.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await expect(service.join(String(id()), String(id()))).resolves.toBeDefined();
  });

  it('backs out when two people race for the last seat', async () => {
    const { service, memberModel } = build(circle(), 1);
    memberModel.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(3);
    await expect(service.join(String(id()), String(id()))).rejects.toThrow('This circle is full');
    expect(memberModel.updateOne).toHaveBeenCalledWith(expect.anything(), { status: 'left' });
  });

  it('turns a join on an invite-only circle into a pending request and notifies the owner', async () => {
    const { service, memberModel, notifications } = build(circle({ visibility: 'invite' }), 2);
    await service.join(String(id()), String(id()));
    expect(memberModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('pending');
    expect(notifications.create).toHaveBeenCalled();
  });

  it('notifies the owner and the other members when someone joins a public circle', async () => {
    const { service, memberModel, notifications } = build(circle(), 1);
    memberModel.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const owner = id();
    const other = id();
    memberModel.find.mockReturnValue({
      select: () => lean([{ userId: owner }, { userId: other }]),
    });
    await service.join(String(id()), String(id()));
    const types = notifications.create.mock.calls.map((c) => c[0].type);
    expect(types).toEqual(['CIRCLE_MEMBER_JOINED', 'CIRCLE_MEMBER_JOINED']);
    expect(notifications.create.mock.calls.map((c) => String(c[0].recipientId))).toEqual([
      String(owner),
      String(other),
    ]);
  });

  it('does not let a removed member come back', async () => {
    const { service } = build(circle(), 0, { status: 'removed' });
    await expect(service.join(String(id()), String(id()))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects closed circles', async () => {
    const { service } = build(circle({ status: 'closed' }), 0);
    await expect(service.join(String(id()), String(id()))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CircleSessionsService goal and checkout windows', () => {
  const HOUR = 60 * 60 * 1000;

  function build(startsAt: Date, over: Record<string, unknown> = {}, member: unknown = { status: 'active' }) {
    const session = { _id: id(), status: 'planned', startsAt, durationMin: 60, ...over };
    const memberModel = { findOne: jest.fn().mockReturnValue(lean(member)) };
    const sessionModel = {
      findOne: jest.fn().mockReturnValue(lean(session)),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      findById: jest.fn().mockReturnValue(lean(session)),
    };
    const service = new CircleSessionsService({} as any, memberModel as any, sessionModel as any);
    return { service, sessionModel };
  }

  const ids = () => [String(id()), String(id()), String(id())] as const;

  it('rejects a goal more than 24 hours before the session', async () => {
    const { service } = build(new Date(Date.now() + 30 * HOUR));
    const [c, s, u] = ids();
    await expect(service.setGoal(c, s, u, { goal: 'write 500 words' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a goal inside the window', async () => {
    const { service, sessionModel } = build(new Date(Date.now() + 2 * HOUR));
    const [c, s, u] = ids();
    await service.setGoal(c, s, u, { goal: 'write 500 words' });
    expect(sessionModel.updateOne).toHaveBeenCalled();
  });

  it('rejects a goal after the session ended', async () => {
    const { service } = build(new Date(Date.now() - 3 * HOUR));
    const [c, s, u] = ids();
    await expect(service.setGoal(c, s, u, { goal: 'late' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects checkout before the session starts and more than 24 hours after it ends', async () => {
    const [c, s, u] = ids();
    await expect(
      build(new Date(Date.now() + HOUR)).service.checkout(c, s, u, { result: 'done' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      build(new Date(Date.now() - 30 * HOUR)).service.checkout(c, s, u, { result: 'done' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts checkout shortly after the session', async () => {
    const { service, sessionModel } = build(new Date(Date.now() - 2 * HOUR));
    const [c, s, u] = ids();
    await service.checkout(c, s, u, { result: 'partial', note: 'got through the intro' });
    expect(sessionModel.updateOne).toHaveBeenCalled();
  });

  it('refuses goals from people who are not active members', async () => {
    const { service } = build(new Date(Date.now() + HOUR), {}, null);
    const [c, s, u] = ids();
    await expect(service.setGoal(c, s, u, { goal: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses reading sessions (and goals) to non-members', async () => {
    const { service } = build(new Date(), {}, null);
    const [c, , u] = ids();
    await expect(service.list(c, u)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
