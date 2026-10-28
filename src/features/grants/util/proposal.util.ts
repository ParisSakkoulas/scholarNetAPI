import { deadlineStage } from './grant-alerts.util';
import { daysLeft } from './grant-filter.util';

/** The sections every new proposal starts with. They can be renamed, removed and added to. */
export const DEFAULT_SECTIONS = [
  'Abstract',
  'Work plan',
  'Budget',
  'CV',
  'Ethics statement',
  'Letters of support',
] as const;

/** Section status -> the column of the Kanban board its card lives in, and the card's own status. */
export const CARD_FOR_STATUS = {
  todo: { column: 'To Do', status: 'todo' },
  writing: { column: 'In Progress', status: 'in_progress' },
  review: { column: 'In Progress', status: 'in_progress' },
  done: { column: 'Done', status: 'done' },
} as const;

export type ReminderKey = 'official14' | 'official3' | 'internal3';

export interface ReminderDue {
  key: ReminderKey;
  /** The deadline this reminder is about; stored once sent, so a changed deadline re-arms it. */
  forDeadline: Date;
  message: string;
}

interface ReminderInput {
  title: string;
  status: string;
  officialDeadline: Date;
  internalDeadline?: Date | null;
  reminders?: Partial<Record<ReminderKey, Date | null>>;
}

const sameInstant = (a?: Date | null, b?: Date | null) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
const wording = (days: number) => (days <= 0 ? 'less than a day' : days === 1 ? '1 day' : `${days} days`);

/** Proposals that are already submitted or decided need no reminders. */
const ACTIVE = new Set(['planning', 'writing', 'review']);

/**
 * Which reminders a proposal is due for today: the official deadline at 14 and 3 days, and the
 * internal one at 3 days. A reminder is sent once per deadline value.
 */
export function remindersDue(p: ReminderInput, now = new Date()): ReminderDue[] {
  if (!ACTIVE.has(p.status)) return [];
  const due: ReminderDue[] = [];

  const officialLeft = daysLeft(p.officialDeadline, now);
  const stage = deadlineStage(officialLeft);
  if (stage) {
    const key: ReminderKey = stage === 14 ? 'official14' : 'official3';
    // a proposal that skipped the 14 day mark (started late) still gets the 3 day one
    if (!sameInstant(p.reminders?.[key], p.officialDeadline)) {
      due.push({
        key,
        forDeadline: p.officialDeadline,
        message: `"${p.title}": the funder's deadline is in ${wording(officialLeft)}`,
      });
    }
  }

  if (p.internalDeadline) {
    const internalLeft = daysLeft(p.internalDeadline, now);
    if (internalLeft >= 0 && internalLeft <= 3 && !sameInstant(p.reminders?.internal3, p.internalDeadline)) {
      due.push({
        key: 'internal3',
        forDeadline: p.internalDeadline,
        message: `"${p.title}": your internal deadline is in ${wording(internalLeft)}`,
      });
    }
  }
  return due;
}

/** A section's due date is worth a reminder in the last 2 days, once per due date, while it is unfinished. */
export function sectionReminderDue(
  s: { status: string; dueDate?: Date | null; ownerId?: unknown; dueRemindedFor?: Date | null },
  now = new Date(),
): boolean {
  if (!s.dueDate || !s.ownerId || s.status === 'done') return false;
  const left = daysLeft(s.dueDate, now);
  return left >= 0 && left <= 2 && !sameInstant(s.dueRemindedFor, s.dueDate);
}
