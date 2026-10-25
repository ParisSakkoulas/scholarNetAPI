import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const SUPERVISION_STATUSES = ['pending', 'active', 'ended', 'declined'] as const;
export type SupervisionStatus = (typeof SUPERVISION_STATUSES)[number];

@Schema({ timestamps: true })
export class Supervision extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true })
  studentId!: mongoose.Types.ObjectId;

  /** First = primary supervisor, the rest are co-supervisors. Empty while an email invite is unclaimed. */
  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] })
  supervisorIds!: mongoose.Types.ObjectId[];

  /** Set when the invited supervisor is not on the platform yet; claimed after signup. */
  @Prop({ type: String, default: null, lowercase: true, trim: true })
  inviteEmail?: string | null;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, enum: SUPERVISION_STATUSES, default: 'pending' })
  status!: SupervisionStatus;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  endedAt?: Date | null;
}

export const SupervisionSchema = SchemaFactory.createForClass(Supervision);

// supervisor dashboard
SupervisionSchema.index({ supervisorIds: 1, status: 1 });
// claiming email invites after signup
SupervisionSchema.index({ inviteEmail: 1, status: 1 });
