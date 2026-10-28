import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const GRANT_STATUSES = ['pending', 'open', 'closed', 'rejected'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const GRANT_SOURCES = ['admin', 'user', 'import'] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

export const CAREER_STAGES = ['phd', 'postdoc', 'early', 'established'] as const;
export const FUNDING_TYPES = ['project', 'fellowship', 'travel', 'other'] as const;

@Schema({ _id: false })
export class GrantAmount {
  @Prop({ min: 0 })
  min?: number;

  @Prop({ min: 0 })
  max?: number;

  @Prop({ required: true, uppercase: true, trim: true, maxlength: 3 })
  currency!: string;
}
const GrantAmountSchema = SchemaFactory.createForClass(GrantAmount);

/** A funding call. The official page is the source of truth; this is a pointer plus a summary. */
@Schema({ timestamps: true })
export class GrantCall extends Document {
  @Prop({ required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ required: true, trim: true, maxlength: 150 })
  funder!: string;

  /** Official call page, https only. */
  @Prop({ required: true, trim: true, maxlength: 1000 })
  url!: string;

  @Prop({ required: true, trim: true, maxlength: 4000 })
  description!: string;

  /** Eligible countries (ISO 3166 alpha-2, upper case). Empty means any. */
  @Prop({ type: [String], default: [] })
  countries!: string[];

  /** Empty means any. */
  @Prop({ type: [String], default: [] })
  careerStages!: string[];

  @Prop({ type: [String], default: [] })
  fields!: string[];

  @Prop({ type: String, required: true, trim: true, maxlength: 50 })
  fundingType!: string;

  @Prop({ type: GrantAmountSchema })
  amount?: GrantAmount;

  @Prop({ type: Date })
  opensAt?: Date;

  @Prop({ type: Date, required: true, index: true })
  deadline!: Date;

  /** When someone last compared this record with the official page. */
  @Prop({ type: Date, required: true })
  lastCheckedAt!: Date;

  @Prop({ type: String, enum: GRANT_STATUSES, default: 'open' })
  status!: GrantStatus;

  @Prop({ type: String, enum: GRANT_SOURCES, default: 'admin' })
  source!: GrantSource;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  submittedBy?: mongoose.Types.ObjectId;

  /** Why a submission was rejected; shown to the submitter. */
  @Prop({ trim: true, maxlength: 500 })
  reviewNote?: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  reviewedBy?: mongoose.Types.ObjectId;
}

export const GrantCallSchema = SchemaFactory.createForClass(GrantCall);
GrantCallSchema.index({ status: 1, deadline: 1 });
GrantCallSchema.index({ submittedBy: 1 });
