import { DEFAULT_SECTIONS, remindersDue, sectionReminderDue } from './proposal.util';

const NOW = new Date('2026-06-01T00:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000 - 1000);

const proposal = (over: Record<string, unknown> = {}) => ({
  title: 'My proposal',
  status: 'writing',
  officialDeadline: inDays(30),
  internalDeadline: null as Date | null,
  reminders: {} as Record<string, Date | null>,
  ...over,
});

describe('default sections', () => {
  it('are the six the brief asks for', () => {
    expect([...DEFAULT_SECTIONS]).toEqual([
      'Abstract', 'Work plan', 'Budget', 'CV', 'Ethics statement', 'Letters of support',
    ]);
  });
});

describe('remindersDue', () => {
  it('is empty while the funder deadline is more than 14 days away', () => {
    expect(remindersDue(proposal(), NOW)).toEqual([]);
  });

  it('sends the 14 day reminder, then not again for the same deadline', () => {
    const p = proposal({ officialDeadline: inDays(10) });
    const [first] = remindersDue(p, NOW);
    expect(first.key).toBe('official14');
    expect(first.message).toContain('10 days');
    expect(remindersDue({ ...p, reminders: { official14: p.officialDeadline } }, NOW)).toEqual([]);
  });

  it('sends the 3 day reminder even when the 14 day one was sent', () => {
    const p = proposal({ officialDeadline: inDays(2), reminders: { official14: inDays(2) } });
    expect(remindersDue(p, NOW).map((d) => d.key)).toEqual(['official3']);
  });

  it('sends the reminders again when the funder moves the deadline', () => {
    const old = inDays(10);
    const moved = inDays(9);
    expect(remindersDue(proposal({ officialDeadline: moved, reminders: { official14: old } }), NOW).map((d) => d.key)).toEqual(['official14']);
  });

  it('reminds about the internal deadline in its last 3 days, once', () => {
    const internal = inDays(2);
    const p = proposal({ internalDeadline: internal });
    expect(remindersDue(p, NOW).map((d) => d.key)).toEqual(['internal3']);
    expect(remindersDue({ ...p, reminders: { internal3: internal } }, NOW)).toEqual([]);
  });

  it('says nothing for proposals that are submitted or decided', () => {
    for (const status of ['submitted', 'awarded', 'rejected']) {
      expect(remindersDue(proposal({ status, officialDeadline: inDays(2) }), NOW)).toEqual([]);
    }
  });

  it('says nothing once the deadline has passed', () => {
    expect(remindersDue(proposal({ officialDeadline: inDays(-1) }), NOW)).toEqual([]);
  });
});

describe('sectionReminderDue', () => {
  const owner = { id: 1 };

  it('is due in the last 2 days of an unfinished, assigned section', () => {
    expect(sectionReminderDue({ status: 'writing', dueDate: inDays(1), ownerId: owner }, NOW)).toBe(true);
  });

  it('is not due too early, when finished, or without an owner', () => {
    expect(sectionReminderDue({ status: 'writing', dueDate: inDays(5), ownerId: owner }, NOW)).toBe(false);
    expect(sectionReminderDue({ status: 'done', dueDate: inDays(1), ownerId: owner }, NOW)).toBe(false);
    expect(sectionReminderDue({ status: 'todo', dueDate: inDays(1) }, NOW)).toBe(false);
  });

  it('is sent once per due date, and again after the date changes', () => {
    const due = inDays(1);
    expect(sectionReminderDue({ status: 'todo', dueDate: due, ownerId: owner, dueRemindedFor: due }, NOW)).toBe(false);
    expect(sectionReminderDue({ status: 'todo', dueDate: inDays(2), ownerId: owner, dueRemindedFor: due }, NOW)).toBe(true);
  });
});
