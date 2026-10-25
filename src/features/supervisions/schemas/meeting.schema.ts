import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const MEETING_STATUSES = ['planned', 'done', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

@Schema()
export class AgendaItem {
  @Prop({ required: true, trim: true, maxlength: 500 })
  text!: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  addedBy!: mongoose.Types.ObjectId;
}
const AgendaItemSchema = SchemaFactory.createForClass(AgendaItem);

@Schema({ timestamps: true })
export class Meeting extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Supervision', required: true })
  supervisionId!: mongoose.Types.ObjectId;

  @Prop({ type: Date, required: true })
  scheduledAt!: Date;

  @Prop({ type: String, enum: MEETING_STATUSES, default: 'planned' })
  status!: MeetingStatus;

  @Prop({ type: [AgendaItemSchema], default: [] })
  agenda!: AgendaItem[];

  @Prop({ type: String, default: '', maxlength: 20000 })
  notes?: string;

  @Prop({ type: Date, default: null })
  reminderSentAt?: Date | null;
}

export const MeetingSchema = SchemaFactory.createForClass(Meeting);
MeetingSchema.index({ supervisionId: 1, scheduledAt: 1 });
