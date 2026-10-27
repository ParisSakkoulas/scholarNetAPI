import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const CIRCLE_STAGES = ['thesis', 'paper', 'grant', 'other'] as const;
export type CircleStage = (typeof CIRCLE_STAGES)[number];

export const CIRCLE_VISIBILITIES = ['public', 'invite'] as const;
export type CircleVisibility = (typeof CIRCLE_VISIBILITIES)[number];

export const CIRCLE_STATUSES = ['active', 'paused', 'closed'] as const;
export type CircleStatus = (typeof CIRCLE_STATUSES)[number];

export const DEFAULT_MAX_MEMBERS = 6;
export const HARD_MAX_MEMBERS = 8;

/** Weekly recurrence. `weekday` is ISO: 1 = Monday ... 7 = Sunday. `time` is local "HH:mm" in `timezone`. */
@Schema({ _id: false })
export class CircleSchedule {
  @Prop({ required: true, min: 1, max: 7 })
  weekday!: number;

  @Prop({ required: true })
  time!: string;

  @Prop({ required: true, min: 15, max: 240 })
  durationMin!: number;

  /** IANA zone, e.g. "Europe/Athens". Daylight saving time is applied when sessions are generated. */
  @Prop({ required: true })
  timezone!: string;
}
const CircleScheduleSchema = SchemaFactory.createForClass(CircleSchedule);

@Schema({ timestamps: true })
export class Circle extends Document {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ trim: true, maxlength: 1000 })
  description?: string;

  @Prop({ required: true, trim: true, maxlength: 100, index: true })
  field!: string;

  @Prop({ type: String, enum: CIRCLE_STAGES, required: true, index: true })
  stage!: CircleStage;

  @Prop({ type: String, enum: CIRCLE_VISIBILITIES, default: 'public' })
  visibility!: CircleVisibility;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  ownerId!: mongoose.Types.ObjectId;

  @Prop({ default: DEFAULT_MAX_MEMBERS, min: 2, max: HARD_MAX_MEMBERS })
  maxMembers!: number;

  @Prop({ type: CircleScheduleSchema, required: true })
  schedule!: CircleSchedule;

  @Prop({ trim: true, maxlength: 500 })
  meetingUrl?: string;

  @Prop({ type: String, enum: CIRCLE_STATUSES, default: 'active', index: true })
  status!: CircleStatus;
}

export const CircleSchema = SchemaFactory.createForClass(Circle);
