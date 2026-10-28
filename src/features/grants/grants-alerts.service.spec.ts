import { Types } from 'mongoose';
import { GrantsService } from './grants.service';

const id = () => new Types.ObjectId();
const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });
const select = <T>(value: T) => ({ select: () => lean(value) });
const DAY = 24 * 60 * 60 * 1000;

describe('grant alerts', () => {
  const actor = id();

  function build(opts: { prefs?: any[]; saves?: any[]; muted?: any[]; calls?: any[]; doc?: any } = {}) {
    const notifications = { create: jest.fn() };
    const saveModel: any = {
      find: jest.fn().mockReturnValue(select(opts.saves ?? [])),
      updateMany: jest.fn(),
    };
    const prefModel: any = {
      // the "find everybody with alerts on" query, and the "who is muted" query
      find: jest.fn().mockImplementation((q: any) =>
        q.alertsEnabled === false
          ? select(opts.muted ?? [])
          : { limit: () => lean(opts.prefs ?? []) },
      ),
    };
    const callModel: any = {
      exists: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (d) => ({ ...d, _id: id() })),
      find: jest.fn().mockReturnValue(lean(opts.calls ?? [])),
      findById: jest.fn().mockResolvedValue(opts.doc),
    };
    const service = new GrantsService(callModel, saveModel, {} as any, notifications as any, prefModel);
    return { service, notifications, saveModel };
  }

  const pref = (over: Record<string, unknown> = {}) => ({
    userId: id(), countries: [], fields: [], fundingTypes: [], alertsEnabled: true, ...over,
  });
  const dto = (over: Record<string, unknown> = {}) =>
    ({
      title: 'ML fellowship', funder: 'F', url: 'https://f.example/1', description: 'long enough text',
      fundingType: 'fellowship', fields: ['Machine learning'], countries: [], careerStages: [],
      deadline: new Date(Date.now() + 30 * DAY), ...over,
    }) as any;

  describe('a new call goes public', () => {
    it('notifies the users it matches, with the reason, and nobody else', async () => {
      const fits = pref({ fields: ['machine learning'] });
      const other = pref({ fields: ['Biology'] });
      const { service, notifications } = build({ prefs: [fits, other] });
      await service.create(String(actor), dto());
      expect(notifications.create).toHaveBeenCalledTimes(1);
      const n = notifications.create.mock.calls[0][0];
      expect(n.type).toBe('GRANT_NEW_MATCH');
      expect(String(n.recipientId)).toBe(String(fits.userId));
      expect(n.message).toContain('Matches your field: Machine learning');
    });

    it('does not notify the admin who added it, or a closed call', async () => {
      const self = pref({ userId: actor, fields: ['Machine learning'] });
      const a = build({ prefs: [self] });
      await a.service.create(String(actor), dto());
      expect(a.notifications.create).not.toHaveBeenCalled();

      const b = build({ prefs: [pref({ fields: ['Machine learning'] })] });
      await b.service.create(String(actor), dto({ deadline: new Date(Date.now() - DAY) }));
      expect(b.notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('a saved call is edited', () => {
    const stored = (over: Record<string, unknown> = {}) => {
      const state: any = {
        _id: id(), title: 'Saved call', url: 'https://f.example/1', description: 'long enough text', fundingType: 'project',
        status: 'open', deadline: new Date(Date.now() + 30 * DAY), countries: [], careerStages: [], fields: [], ...over,
      };
      state.toObject = () => ({ ...state });
      state.set = (patch: any) => Object.assign(state, patch);
      state.save = jest.fn().mockResolvedValue(undefined);
      return state;
    };

    it('tells the savers what changed and replays the deadline reminders', async () => {
      const saver = id();
      const doc = stored();
      const { service, notifications, saveModel } = build({ doc, saves: [{ userId: saver }] });
      await service.update(String(doc._id), String(actor), { deadline: new Date(Date.now() + 60 * DAY) } as any);
      const n = notifications.create.mock.calls[0][0];
      expect(n.type).toBe('GRANT_UPDATED');
      expect(n.message).toContain('deadline');
      expect(saveModel.updateMany).toHaveBeenCalledWith({ callId: doc._id }, { $set: { lastDeadlineAlert: null } });
    });

    it('stays quiet when nothing a researcher cares about changed', async () => {
      const doc = stored();
      const { service, notifications } = build({ doc, saves: [{ userId: id() }] });
      await service.update(String(doc._id), String(actor), { lastCheckedAt: new Date() } as any);
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('skips people who turned alerts off', async () => {
      const quiet = id();
      const loud = id();
      const doc = stored();
      const { service, notifications } = build({
        doc, saves: [{ userId: quiet }, { userId: loud }], muted: [{ userId: quiet }],
      });
      await service.update(String(doc._id), String(actor), { title: 'New title' } as any);
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(String(notifications.create.mock.calls[0][0].recipientId)).toBe(String(loud));
    });
  });

  describe('saved-call deadline reminders', () => {
    const open = (inDays: number) => ({ _id: id(), title: 'Soon', status: 'open', deadline: new Date(Date.now() + inDays * DAY - 1000) });

    it('sends the 14 day reminder once and records the stage', async () => {
      const call = open(10);
      const s = { _id: id(), userId: id() };
      const { service, notifications, saveModel } = build({ calls: [call], saves: [s] });
      await service.remindSavedDeadlines();
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create.mock.calls[0][0].type).toBe('GRANT_DEADLINE_SOON');
      // the query only picks saves that have not had this stage yet
      expect(saveModel.find.mock.calls[0][0].lastDeadlineAlert).toEqual({ $in: [null] });
      expect(saveModel.updateMany).toHaveBeenCalledWith({ _id: { $in: [s._id] } }, { $set: { lastDeadlineAlert: 14 } });
    });

    it('sends the 3 day reminder to saves that only had the 14 day one', async () => {
      const call = open(2);
      const { service, saveModel } = build({ calls: [call], saves: [{ _id: id(), userId: id() }] });
      await service.remindSavedDeadlines();
      expect(saveModel.find.mock.calls[0][0].lastDeadlineAlert).toEqual({ $in: [null, 14] });
      expect(saveModel.updateMany.mock.calls[0][1]).toEqual({ $set: { lastDeadlineAlert: 3 } });
    });

    it('ignores calls that are further away than 14 days', async () => {
      const { service, saveModel, notifications } = build({ calls: [open(20)], saves: [{ _id: id(), userId: id() }] });
      await service.remindSavedDeadlines();
      expect(saveModel.find).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });
});
