import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { Supervision } from './schemas/supervision.schema';
import { Milestone } from './schemas/milestone.schema';
import { Meeting } from './schemas/meeting.schema';
import { ActionItem } from './schemas/action-item.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Daily run at 08:00 UTC, so "tomorrow" covers meetings up to ~a day and a half ahead. */
const MEETING_WINDOW_MS = 36 * 60 * 60 * 1000;

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Daily job: finds what is due soon or overdue and notifies once per stage.
 * The *NotifiedAt fields make it safe to re-run and to restart mid-day.
 */
@Injectable()
export class SupervisionRemindersService {
  private readonly logger = new Logger(SupervisionRemindersService.name);

  constructor(
    @InjectModel(Supervision.name) private supervisionModel: Model<Supervision>,
    @InjectModel(Milestone.name) private milestoneModel: Model<Milestone>,
    @InjectModel(Meeting.name) private meetingModel: Model<Meeting>,
    @InjectModel(ActionItem.name) private actionItemModel: Model<ActionItem>,
    private notifications: NotificationsService,
  ) {}

  @Cron('0 8 * * *', { name: 'supervision-reminders', timeZone: 'UTC' })
  async runDaily() {
    try {
      await this.milestoneReminders();
      await this.actionItemReminders();
      await this.meetingReminders();
    } catch (err) {
      this.logger.error('Daily supervision reminders failed', err as Error);
    }
  }

  private async milestoneReminders() {
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * DAY_MS);
    const open = { status: { $ne: 'approved' }, dueDate: { $ne: null } };

    const [dueSoon, overdue] = await Promise.all([
      this.milestoneModel
        .find({ ...open, dueDate: { $gte: now, $lte: soon }, dueSoonNotifiedAt: null })
        .lean(),
      this.milestoneModel.find({ ...open, dueDate: { $lt: now }, overdueNotifiedAt: null }).lean(),
    ]);

    const people = await this.participants([...dueSoon, ...overdue].map((m) => m.supervisionId));

    await this.notifyAll(dueSoon, async (m) => {
      const p = people.get(String(m.supervisionId));
      if (!p) return false;
      await Promise.all(
        p.map((recipientId) =>
          this.notifications.create({
            recipientId,
            type: NotificationType.MILESTONE_DUE_SOON,
            message: `Milestone "${m.title}" is due on ${fmt(m.dueDate!)}`,
            entityType: 'supervision',
            entityId: m.supervisionId,
            data: { milestoneId: String(m._id) },
          }),
        ),
      );
      return true;
    }, this.milestoneModel, 'dueSoonNotifiedAt');

    await this.notifyAll(overdue, async (m) => {
      const p = people.get(String(m.supervisionId));
      if (!p) return false;
      await Promise.all(
        p.map((recipientId) =>
          this.notifications.create({
            recipientId,
            type: NotificationType.MILESTONE_OVERDUE,
            message: `Milestone "${m.title}" was due on ${fmt(m.dueDate!)} and is overdue`,
            entityType: 'supervision',
            entityId: m.supervisionId,
            data: { milestoneId: String(m._id) },
          }),
        ),
      );
      return true;
    }, this.milestoneModel, 'overdueNotifiedAt');
  }

  private async actionItemReminders() {
    const now = new Date();
    const soon = new Date(now.getTime() + 2 * DAY_MS);
    const open = { status: 'open', dueDate: { $ne: null } };

    const [dueSoon, overdue] = await Promise.all([
      this.actionItemModel
        .find({ ...open, dueDate: { $gte: now, $lte: soon }, dueSoonNotifiedAt: null })
        .lean(),
      this.actionItemModel.find({ ...open, dueDate: { $lt: now }, overdueNotifiedAt: null }).lean(),
    ]);

    const active = await this.participants([...dueSoon, ...overdue].map((i) => i.supervisionId));

    const send = (type: NotificationType, verb: string) => async (i: ActionItem) => {
      if (!active.has(String(i.supervisionId))) return false;
      await this.notifications.create({
        recipientId: i.assigneeId,
        type,
        message: `Action item "${i.text.slice(0, 100)}" ${verb} ${fmt(i.dueDate!)}`,
        entityType: 'supervision',
        entityId: i.supervisionId,
        data: { actionItemId: String(i._id) },
      });
      return true;
    };

    await this.notifyAll(
      dueSoon,
      send(NotificationType.ACTION_ITEM_DUE_SOON, 'is due on'),
      this.actionItemModel,
      'dueSoonNotifiedAt',
    );
    await this.notifyAll(
      overdue,
      send(NotificationType.ACTION_ITEM_OVERDUE, 'was due on'),
      this.actionItemModel,
      'overdueNotifiedAt',
    );
  }

  private async meetingReminders() {
    const now = new Date();
    const meetings = await this.meetingModel
      .find({
        status: 'planned',
        scheduledAt: { $gte: now, $lte: new Date(now.getTime() + MEETING_WINDOW_MS) },
        reminderSentAt: null,
      })
      .lean();

    const people = await this.participants(meetings.map((m) => m.supervisionId));

    await this.notifyAll(meetings, async (m) => {
      const p = people.get(String(m.supervisionId));
      if (!p) return false;
      const topics = m.agenda.length
        ? `${m.agenda.length} agenda item${m.agenda.length === 1 ? '' : 's'} so far, add yours`
        : 'the agenda is empty, add your topics';
      await Promise.all(
        p.map((recipientId) =>
          this.notifications.create({
            recipientId,
            type: NotificationType.MEETING_REMINDER,
            message: `Meeting on ${m.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')} UTC: ${topics}`,
            entityType: 'supervision',
            entityId: m.supervisionId,
            data: { meetingId: String(m._id) },
          }),
        ),
      );
      return true;
    }, this.meetingModel, 'reminderSentAt');
  }

  /** Participants of the ACTIVE supervisions among `ids`; ended or pending ones get no reminders. */
  private async participants(ids: Types.ObjectId[]) {
    const unique = [...new Set(ids.map(String))];
    const out = new Map<string, Types.ObjectId[]>();
    if (!unique.length) return out;
    const list = await this.supervisionModel
      .find({ _id: { $in: unique }, status: 'active' })
      .select('studentId supervisorIds')
      .lean();
    for (const s of list) out.set(String(s._id), [s.studentId, ...s.supervisorIds]);
    return out;
  }

  /** Runs `send` per row, then stamps `field` so the row is not notified again. */
  private async notifyAll<T extends { _id: Types.ObjectId }>(
    rows: T[],
    send: (row: T) => Promise<boolean>,
    model: Model<any>,
    field: string,
  ) {
    const done: Types.ObjectId[] = [];
    for (const row of rows) {
      try {
        if (await send(row)) done.push(row._id);
      } catch (err) {
        this.logger.error(`Reminder failed for ${String(row._id)}`, err as Error);
      }
    }
    if (done.length) await model.updateMany({ _id: { $in: done } }, { $set: { [field]: new Date() } });
  }
}
