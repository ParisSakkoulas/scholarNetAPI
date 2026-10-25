import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const ACTION_ITEM_STATUSES = ['open', 'done'] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

/** A file a supervisor attached to a task for the student (reading, a template, feedback...). */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ActionItemFile {
  _id!: mongoose.Types.ObjectId;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true })
  size!: number;

  /** Opaque key in FileStorage; never sent to the client. */
  @Prop({ type: String, required: true, select: false })
  storageKey!: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: mongoose.Types.ObjectId;

  createdAt!: Date;
}
export const ActionItemFileSchema = SchemaFactory.createForClass(ActionItemFile);

@Schema({ timestamps: true })
export class ActionItem extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Supervision', required: true })
  supervisionId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', default: null })
  meetingId?: mongoose.Types.ObjectId | null;

  @Prop({ required: true, trim: true, maxlength: 500 })
  text!: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  assigneeId!: mongoose.Types.ObjectId;

  @Prop({ type: Date, default: null })
  dueDate?: Date | null;

  @Prop({ type: String, enum: ACTION_ITEM_STATUSES, default: 'open' })
  status!: ActionItemStatus;

  @Prop({ type: [ActionItemFileSchema], default: [] })
  attachments!: ActionItemFile[];

  @Prop({ type: Date, default: null })
  dueSoonNotifiedAt?: Date | null;

  @Prop({ type: Date, default: null })
  overdueNotifiedAt?: Date | null;
}

export const ActionItemSchema = SchemaFactory.createForClass(ActionItem);
ActionItemSchema.index({ supervisionId: 1, dueDate: 1 });
ActionItemSchema.index({ meetingId: 1 });
