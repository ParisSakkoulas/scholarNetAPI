import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const SESSION_STATUSES = ['planned', 'done', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_RESULTS = ['done', 'partial', 'missed'] as const;
export type SessionResult = (typeof SESSION_RESULTS)[number];

/** Only the goal and the reported result are stored — never the writing itself. */
@Schema({ _id: false })
export class SessionEntry {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  userId!: mongoose.Types.ObjectId;

  /** True once the member has checked out. */
  @Prop({ default: false })
  attended!: boolean;

  @Prop({ trim: true, maxlength: 500 })
  goal?: string;

  @Prop({ type: String, enum: SESSION_RESULTS })
  result?: SessionResult;

  @Prop({ trim: true, maxlength: 1000 })
  note?: string;
}
const SessionEntrySchema = SchemaFactory.createForClass(SessionEntry);

@Schema({ timestamps: true })
export class CircleSession extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Circle', required: true, index: true })
  circleId!: mongoose.Types.ObjectId;

  /** Always UTC; computed from the circle's IANA time zone when generated. */
  @Prop({ type: Date, required: true })
  startsAt!: Date;

  @Prop({ required: true })
  durationMin!: number;

  @Prop({ type: String, enum: SESSION_STATUSES, default: 'planned' })
  status!: SessionStatus;

  @Prop({ type: [SessionEntrySchema], default: [] })
  entries!: SessionEntry[];
}

export const CircleSessionSchema = SchemaFactory.createForClass(CircleSession);
// unique, so the daily generator can safely run twice
CircleSessionSchema.index({ circleId: 1, startsAt: 1 }, { unique: true });
