import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { NotificationType } from '../notification-type.enum';

/** Notifications older than this are removed automatically by MongoDB. */
const NOTIFICATION_TTL_SECONDS = 90 * 24 * 60 * 60;

@Schema({ timestamps: true })
export class Notification extends Document {
  /** The user who receives (and is the only one who can read) this notification. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  recipient!: mongoose.Types.ObjectId;

  /** Who triggered it; null for system notifications. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null })
  actor?: mongoose.Types.ObjectId | null;

  @Prop({ type: String, enum: Object.values(NotificationType), required: true })
  type!: NotificationType;

  @Prop({ required: true, trim: true, maxlength: 300 })
  message!: string;

  /** What the notification is about, so the frontend can deep-link (e.g. 'team' + teamId). */
  @Prop({ type: String, default: null })
  entityType?: string | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null })
  entityId?: mongoose.Types.ObjectId | null;

  /** Free-form extras for the frontend (team name, task title...). */
  @Prop({ type: mongoose.Schema.Types.Mixed, default: null })
  data?: Record<string, unknown> | null;

  @Prop({ default: false })
  isRead!: boolean;

  @Prop({ type: Date, default: null })
  readAt?: Date | null;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// inbox listing + unread badge
NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, createdAt: -1 });
// auto-cleanup
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });
