import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Meeting } from './schemas/meeting.schema';
import { ActionItem } from './schemas/action-item.schema';
import { AgendaItemDto, CreateMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';
import { SupervisionAccess } from './guards/supervision-access.guard';

@Injectable()
export class MeetingsService {
  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<Meeting>,
    @InjectModel(ActionItem.name) private actionItemModel: Model<ActionItem>,
  ) {}

  list(access: SupervisionAccess) {
    return this.meetingModel
      .find({ supervisionId: access.supervision._id })
      .sort({ scheduledAt: -1 })
      .lean();
  }

  /** A meeting with the action items that came out of it, for the meeting page. */
  async get(access: SupervisionAccess, id: string) {
    const meeting = await this.findOrFail(access, id);
    const actionItems = await this.actionItemModel
      .find({ supervisionId: access.supervision._id, meetingId: meeting._id })
      .sort({ dueDate: 1 })
      .populate('assigneeId', 'username firstName lastName profilePhotoUrl')
      .lean();
    return { ...meeting.toObject(), actionItems };
  }

  create(access: SupervisionAccess, dto: CreateMeetingDto) {
    return this.meetingModel.create({
      supervisionId: access.supervision._id,
      scheduledAt: dto.scheduledAt,
      agenda: dto.firstAgendaItem ? [{ text: dto.firstAgendaItem, addedBy: access.userId }] : [],
    });
  }

  async update(access: SupervisionAccess, id: string, dto: UpdateMeetingDto) {
    const meeting = await this.findOrFail(access, id);
    if (dto.scheduledAt !== undefined) {
      meeting.scheduledAt = dto.scheduledAt;
      meeting.reminderSentAt = null; // rescheduled: remind again
    }
    if (dto.status !== undefined) meeting.status = dto.status;
    if (dto.notes !== undefined) meeting.notes = dto.notes;
    return meeting.save();
  }

  async remove(access: SupervisionAccess, id: string) {
    const meeting = await this.findOrFail(access, id);
    await meeting.deleteOne();
    // keep the tasks, they just stop belonging to a meeting
    await this.actionItemModel.updateMany(
      { supervisionId: access.supervision._id, meetingId: meeting._id },
      { $set: { meetingId: null } },
    );
    return { deleted: true };
  }

  // ---------------- AGENDA (both sides) ----------------

  async addAgendaItem(access: SupervisionAccess, id: string, dto: AgendaItemDto) {
    const meeting = await this.findOrFail(access, id);
    meeting.agenda.push({ text: dto.text, addedBy: new Types.ObjectId(access.userId) });
    return meeting.save();
  }

  async removeAgendaItem(access: SupervisionAccess, id: string, itemId: string) {
    const meeting = await this.findOrFail(access, id);
    const item = Types.ObjectId.isValid(itemId)
      ? (meeting.agenda as unknown as Types.DocumentArray<{ _id: Types.ObjectId }>).id(itemId)
      : null;
    if (!item) throw new NotFoundException('Agenda item not found.');
    item.deleteOne();
    return meeting.save();
  }

  private async findOrFail(access: SupervisionAccess, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Meeting not found.');
    const m = await this.meetingModel.findOne({ _id: id, supervisionId: access.supervision._id });
    if (!m) throw new NotFoundException('Meeting not found.');
    return m;
  }
}
