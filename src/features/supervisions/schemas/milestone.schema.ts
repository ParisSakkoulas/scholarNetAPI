import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const MILESTONE_STATUSES = [
  'todo',
  'in_progress',
  'submitted',
  'needs_changes',
  'approved',
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

@Schema({ timestamps: true })
export class Milestone extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Supervision', required: true })
  supervisionId!: mongoose.Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, trim: true, maxlength: 2000, default: '' })
  description?: string;

  @Prop({ type: Number, default: 0 })
  order!: number;

  /** Stored in UTC; the client shows it in the user's zone. */
  @Prop({ type: Date, default: null })
  dueDate?: Date | null;

  @Prop({ type: String, enum: MILESTONE_STATUSES, default: 'todo' })
  status!: MilestoneStatus;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  // reminder bookkeeping so the daily cron notifies once per stage
  @Prop({ type: Date, default: null })
  dueSoonNotifiedAt?: Date | null;

  @Prop({ type: Date, default: null })
  overdueNotifiedAt?: Date | null;
}

export const MilestoneSchema = SchemaFactory.createForClass(Milestone);
MilestoneSchema.index({ supervisionId: 1, dueDate: 1 });
