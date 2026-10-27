import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const CIRCLE_MEMBER_ROLES = ['owner', 'member'] as const;
export const CIRCLE_MEMBER_STATUSES = ['pending', 'active', 'paused', 'left', 'removed'] as const;
export type CircleMemberStatus = (typeof CIRCLE_MEMBER_STATUSES)[number];

@Schema({ timestamps: true })
export class CircleMember extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Circle', required: true, index: true })
  circleId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: mongoose.Types.ObjectId;

  @Prop({ type: String, enum: CIRCLE_MEMBER_ROLES, default: 'member' })
  role!: 'owner' | 'member';

  @Prop({ type: String, enum: CIRCLE_MEMBER_STATUSES, default: 'pending' })
  status!: CircleMemberStatus;

  @Prop({ default: 0 })
  missedInRow!: number;

  /** Consecutive attended sessions. */
  @Prop({ default: 0 })
  streak!: number;

  @Prop({ default: 0 })
  totalSessions!: number;

  @Prop({ type: Date, default: null })
  joinedAt?: Date | null;
}

export const CircleMemberSchema = SchemaFactory.createForClass(CircleMember);
// one row per person per circle: re-joining reuses it
CircleMemberSchema.index({ circleId: 1, userId: 1 }, { unique: true });
CircleMemberSchema.index({ userId: 1, status: 1 });
CircleMemberSchema.index({ circleId: 1, status: 1 });
