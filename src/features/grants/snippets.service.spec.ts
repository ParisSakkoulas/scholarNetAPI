import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SnippetsService } from './snippets.service';

const id = () => new Types.ObjectId();
const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

function build(opts: { teams?: { teamId: Types.ObjectId; role: string }[]; snippet?: any } = {}) {
  const created: any[] = [];
  const snippetModel: any = {
    find: jest.fn(),
    findById: jest.fn().mockResolvedValue(opts.snippet ?? null),
    create: jest.fn().mockImplementation(async (d) => {
      created.push(d);
      return { _id: id(), ...d };
    }),
  };
  // .find().sort().populate().populate().lean()
  const chain: any = { sort: () => chain, populate: () => chain, lean: () => Promise.resolve(opts.snippet ? [opts.snippet] : []) };
  snippetModel.find.mockReturnValue(chain);
  const memberModel: any = {
    find: jest.fn().mockReturnValue({ select: () => lean(opts.teams ?? []) }),
  };
  return { service: new SnippetsService(snippetModel, memberModel), snippetModel, created };
}

const stored = (over: Record<string, unknown> = {}) => {
  const s: any = { _id: id(), ownerId: id(), type: 'bio', title: 'My bio', content: 'text', set: jest.fn(), save: jest.fn(), deleteOne: jest.fn(), ...over };
  return s;
};

describe('SnippetsService.create', () => {
  it('creates a personal snippet by default', async () => {
    const { service, created } = build();
    await service.create(String(id()), { type: 'bio', title: 'Bio', content: 'I study things.' });
    expect(created[0].teamId).toBeUndefined();
  });

  it('shares with a team only when the author is an active non-viewer member', async () => {
    const team = id();
    const ok = build({ teams: [{ teamId: team, role: 'member' }] });
    await ok.service.create(String(id()), { type: 'bio', title: 'Bio', content: 'x', teamId: String(team) });
    expect(String(ok.created[0].teamId)).toBe(String(team));

    for (const teams of [[{ teamId: team, role: 'viewer' }], []]) {
      const denied = build({ teams });
      await expect(
        denied.service.create(String(id()), { type: 'bio', title: 'Bio', content: 'x', teamId: String(team) }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

describe('SnippetsService access', () => {
  it('hides a personal snippet from everybody but its owner', async () => {
    const snippet = stored();
    const { service } = build({ snippet });
    await expect(service.update(String(snippet._id), String(id()), { title: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(String(snippet._id), String(id()))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the owner edit and delete a personal snippet', async () => {
    const snippet = stored();
    const { service } = build({ snippet });
    await service.update(String(snippet._id), String(snippet.ownerId), { title: 'New' });
    expect(snippet.set).toHaveBeenCalledWith({ title: 'New' });
    await service.remove(String(snippet._id), String(snippet.ownerId));
    expect(snippet.deleteOne).toHaveBeenCalled();
  });

  it('hides a team snippet from people outside the team', async () => {
    const snippet = stored({ teamId: id() });
    const { service } = build({ snippet, teams: [] });
    await expect(service.update(String(snippet._id), String(id()), {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('applies the team rules per role', async () => {
    const team = id();
    const author = id();
    const make = (role: string, user: Types.ObjectId) => {
      const snip = stored({ teamId: team, ownerId: author });
      return { ...build({ snippet: snip, teams: [{ teamId: team, role }] }), snip, user };
    };

    const author1 = make('member', author);
    await expect(author1.service.update(String(author1.snip._id), String(author), { title: 'ok' })).resolves.toBeDefined();

    const admin = make('admin', id());
    await expect(admin.service.update(String(admin.snip._id), String(admin.user), { title: 'ok' })).resolves.toBeDefined();

    const member = make('member', id());
    await expect(member.service.update(String(member.snip._id), String(member.user), { title: 'no' })).rejects.toBeInstanceOf(ForbiddenException);

    const viewer = make('viewer', id());
    await expect(viewer.service.remove(String(viewer.snip._id), String(viewer.user))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SnippetsService.list', () => {
  it('returns nothing for a team the caller is not in', async () => {
    const { service, snippetModel } = build({ teams: [] });
    expect(await service.list(String(id()), { scope: String(id()) })).toEqual([]);
    expect(snippetModel.find).not.toHaveBeenCalled();
  });

  it('asks for personal snippets plus the caller\'s teams by default, never other people\'s', async () => {
    const team = id();
    const { service, snippetModel } = build({ teams: [{ teamId: team, role: 'member' }] });
    const me = String(id());
    await service.list(me, {});
    const filter = snippetModel.find.mock.calls[0][0];
    expect(filter.$or).toHaveLength(2);
    expect(String(filter.$or[0].ownerId)).toBe(me);
    expect(filter.$or[0].teamId).toBeNull();
    expect(filter.$or[1].teamId.$in.map(String)).toEqual([String(team)]);
  });
});
