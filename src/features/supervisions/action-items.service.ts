import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { FileStorage } from '../../common/storage/file-storage';
import { DOCUMENT_EXTENSIONS, decodeUploadName, detectDocumentType } from './document-file.util';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActionItem } from './schemas/action-item.schema';
import { Meeting } from './schemas/meeting.schema';
import { CreateActionItemDto, UpdateActionItemDto } from './dto/action-item.dto';
import { SupervisionAccess } from './guards/supervision-access.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';

const MAX_FILES_PER_ITEM = 10;

const USER_FIELDS = 'username firstName lastName profilePhotoUrl';

@Injectable()
export class ActionItemsService {
  constructor(
    @InjectModel(ActionItem.name) private actionItemModel: Model<ActionItem>,
    @InjectModel(Meeting.name) private meetingModel: Model<Meeting>,
    private notifications: NotificationsService,
    private storage: FileStorage,
    config: ConfigService,
  ) {
    this.maxFileBytes = Number(config.get('THESIS_DOC_MAX_MB') ?? 25) * 1024 * 1024;
  }

  readonly maxFileBytes: number;

  list(access: SupervisionAccess, filter: { status?: string; meetingId?: string; mine?: boolean }) {
    return this.actionItemModel
      .find({
        supervisionId: access.supervision._id,
        ...(filter.status === 'open' || filter.status === 'done' ? { status: filter.status } : {}),
        ...(filter.meetingId && Types.ObjectId.isValid(filter.meetingId)
          ? { meetingId: filter.meetingId }
          : {}),
        ...(filter.mine ? { assigneeId: access.userId } : {}),
      })
      .sort({ dueDate: 1 })
      .populate('assigneeId', USER_FIELDS)
      .lean();
  }

  async create(access: SupervisionAccess, dto: CreateActionItemDto) {
    this.assertParticipant(access, dto.assigneeId);
    if (dto.meetingId) await this.assertMeeting(access, dto.meetingId);

    const item = await this.actionItemModel.create({
      supervisionId: access.supervision._id,
      meetingId: dto.meetingId ?? null,
      text: dto.text,
      assigneeId: dto.assigneeId,
      dueDate: dto.dueDate ?? null,
    });
    await this.notifyAssigned(access, item);
    return item;
  }

  async update(access: SupervisionAccess, id: string, dto: UpdateActionItemDto) {
    const item = await this.findOrFail(access, id);

    let reassigned = false;
    if (dto.assigneeId !== undefined && dto.assigneeId !== String(item.assigneeId)) {
      this.assertParticipant(access, dto.assigneeId);
      item.assigneeId = new Types.ObjectId(dto.assigneeId);
      item.dueSoonNotifiedAt = null;
      item.overdueNotifiedAt = null;
      reassigned = true;
    }
    if (dto.text !== undefined) item.text = dto.text;
    if (dto.status !== undefined) item.status = dto.status;
    if (dto.dueDate !== undefined) {
      item.dueDate = dto.dueDate;
      item.dueSoonNotifiedAt = null;
      item.overdueNotifiedAt = null;
    }
    await item.save();
    if (reassigned) await this.notifyAssigned(access, item);
    return item;
  }

  async remove(access: SupervisionAccess, id: string) {
    const item = await this.findOrFail(access, id, true);
    await item.deleteOne();
    await Promise.all(item.attachments.map((f) => this.storage.delete(f.storageKey)));
    return { deleted: true };
  }

  // ---------------- ATTACHMENTS (supervisor -> student) ----------------

  async addFile(access: SupervisionAccess, id: string, file: Express.Multer.File | undefined) {
    if (access.role !== 'supervisor') {
      throw new ForbiddenException('Only a supervisor can attach files to an action item.');
    }
    const item = await this.findOrFail(access, id);
    if (!file) throw new BadRequestException('No file received (send it as the "file" field).');
    if (item.attachments.length >= MAX_FILES_PER_ITEM) {
      throw new BadRequestException(`An action item can hold up to ${MAX_FILES_PER_ITEM} files.`);
    }
    if (file.size > this.maxFileBytes) {
      throw new BadRequestException(`The file is larger than ${Math.round(this.maxFileBytes / 1048576)} MB.`);
    }
    const type = detectDocumentType(file.originalname, file.buffer);
    if (!type) {
      throw new BadRequestException(
        `Only ${DOCUMENT_EXTENSIONS.join(', ')} files are accepted, and the content must match the extension.`,
      );
    }

    const storageKey = `action-items/${item._id}/${randomUUID()}${type.ext}`;
    await this.storage.save(storageKey, file.buffer);
    try {
      item.attachments.push({
        // eslint-disable-next-line no-control-regex
        fileName: decodeUploadName(file.originalname).replace(/[\u0000-\u001F\u007F"\\/]/g, '_').slice(0, 200),
        mimeType: type.mimeType,
        size: file.size,
        storageKey,
        uploadedBy: new Types.ObjectId(access.userId),
      } as any);
      await item.save();
    } catch (err) {
      await this.storage.delete(storageKey); // do not leave an orphan on disk
      throw err;
    }

    if (String(item.assigneeId) !== access.userId) {
      await this.notifications.create({
        recipientId: item.assigneeId,
        actorId: access.userId,
        type: NotificationType.ACTION_ITEM_ASSIGNED,
        message: `A file was added to your action item: ${item.text.slice(0, 100)}`,
        entityType: 'supervision',
        entityId: access.supervision._id as Types.ObjectId,
        data: { actionItemId: String(item._id) },
      });
    }
    return (await this.findOrFail(access, id)).toObject();
  }

  async openFile(access: SupervisionAccess, id: string, fileId: string) {
    const item = await this.findOrFail(access, id, true);
    const file = item.attachments.find((f) => String(f._id) === fileId);
    if (!file) throw new NotFoundException('File not found.');
    return {
      stream: await this.storage.read(file.storageKey),
      name: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
    };
  }

  async removeFile(access: SupervisionAccess, id: string, fileId: string) {
    if (access.role !== 'supervisor') {
      throw new ForbiddenException('Only a supervisor can remove an attached file.');
    }
    const item = await this.findOrFail(access, id, true);
    const file = item.attachments.find((f) => String(f._id) === fileId);
    if (!file) throw new NotFoundException('File not found.');
    item.attachments = item.attachments.filter((f) => String(f._id) !== fileId) as any;
    await item.save();
    await this.storage.delete(file.storageKey);
    return (await this.findOrFail(access, id)).toObject();
  }

  // ---------------- helpers ----------------

  /** Tasks can only be handed to the people in this supervision. */
  private assertParticipant(access: SupervisionAccess, userId: string) {
    const { studentId, supervisorIds } = access.supervision;
    const ok = [studentId, ...supervisorIds].some((u) => String(u) === userId);
    if (!ok) throw new BadRequestException('The assignee is not part of this supervision.');
  }

  private async assertMeeting(access: SupervisionAccess, meetingId: string) {
    const ok = await this.meetingModel.exists({
      _id: meetingId,
      supervisionId: access.supervision._id,
    });
    if (!ok) throw new BadRequestException('Meeting not found in this supervision.');
  }

  private notifyAssigned(access: SupervisionAccess, item: ActionItem) {
    return this.notifications.create({
      recipientId: item.assigneeId,
      actorId: access.userId,
      type: NotificationType.ACTION_ITEM_ASSIGNED,
      message: `New action item: ${item.text.slice(0, 120)}`,
      entityType: 'supervision',
      entityId: access.supervision._id as Types.ObjectId,
      data: { actionItemId: String(item._id) },
    });
  }

  private async findOrFail(access: SupervisionAccess, id: string, withKeys = false) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Action item not found.');
    const query = this.actionItemModel.findOne({
      _id: id,
      supervisionId: access.supervision._id,
    });
    // storage keys stay hidden unless a file is being read or deleted
    const item = await (withKeys ? query.select('+attachments.storageKey') : query);
    if (!item) throw new NotFoundException('Action item not found.');
    return item;
  }
}
