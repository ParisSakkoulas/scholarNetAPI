import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification } from './schemas/notification.schema';
import { NotificationType } from './notification-type.enum';

export interface CreateNotificationParams {
  recipientId: string | Types.ObjectId;
  actorId?: string | Types.ObjectId | null;
  type: NotificationType;
  message: string;
  entityType?: string;
  entityId?: string | Types.ObjectId;
  data?: Record<string, unknown>;
}

export interface NotificationQuery {
  page: number;
  limit: number;
  skip: number;
  unreadOnly?: boolean;
  type?: NotificationType;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@InjectModel(Notification.name) private notificationModel: Model<Notification>) {}

  // ---------------- CREATE (called by other modules) ----------------

  /**
   * Never throws: a failed notification must not break the action that triggered it.
   * Nobody is notified about their own actions.
   */
  async create(params: CreateNotificationParams): Promise<Notification | null> {
    if (params.actorId && String(params.actorId) === String(params.recipientId)) return null;

    try {
      return await this.notificationModel.create({
        recipient: params.recipientId,
        actor: params.actorId ?? null,
        type: params.type,
        message: params.message,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        data: params.data ?? null,
      });
    } catch (err) {
      this.logger.error(`Failed to create ${params.type} notification`, err as Error);
      return null;
    }
  }

  /** Removes notifications that no longer make sense (e.g. the follower unfollowed). */
  async removeByActor(
    recipientId: string | Types.ObjectId,
    actorId: string | Types.ObjectId,
    type: NotificationType,
    entityId?: string | Types.ObjectId,
  ): Promise<void> {
    await this.notificationModel.deleteMany({
      recipient: recipientId,
      actor: actorId,
      type,
      ...(entityId ? { entityId } : {}),
    });
  }

  /** Removes every notification about an entity that no longer exists (e.g. a deleted post). */
  async removeByEntity(entityType: string, entityId: string | Types.ObjectId): Promise<void> {
    await this.notificationModel.deleteMany({ entityType, entityId });
  }

  // ---------------- READ (current user's inbox) ----------------

  async findForUser(userId: string, q: NotificationQuery) {
    const filter: Record<string, unknown> = { recipient: userId };
    if (q.unreadOnly) filter.isRead = false;
    if (q.type) filter.type = q.type;

    const [data, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(q.skip)
        .limit(q.limit)
        .populate('actor', 'firstName lastName username profilePhotoUrl')
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter),
    ]);

    return { data, total, page: q.page, limit: q.limit };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notificationModel.countDocuments({ recipient: userId, isRead: false });
    return { count };
  }

  // ---------------- UPDATE ----------------

  async markRead(userId: string, notificationId: string) {
    this.assertObjectId(notificationId);
    const updated = await this.notificationModel
      .findOneAndUpdate(
        { _id: notificationId, recipient: userId },
        { $set: { isRead: true, readAt: new Date() } },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Notification not found.');
    return updated;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.notificationModel.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    );
    return { updated: res.modifiedCount };
  }

  // ---------------- DELETE ----------------

  async remove(userId: string, notificationId: string): Promise<{ deleted: true }> {
    this.assertObjectId(notificationId);
    const res = await this.notificationModel.deleteOne({ _id: notificationId, recipient: userId });
    if (!res.deletedCount) throw new NotFoundException('Notification not found.');
    return { deleted: true };
  }

  /** Deletes every notification of the user, or only the already-read ones. */
  async clear(userId: string, onlyRead = false): Promise<{ deleted: number }> {
    const res = await this.notificationModel.deleteMany({
      recipient: userId,
      ...(onlyRead ? { isRead: true } : {}),
    });
    return { deleted: res.deletedCount };
  }

  private assertObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid notification id.');
  }
}
