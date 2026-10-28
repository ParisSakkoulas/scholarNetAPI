import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const REVIEW_STATUSES = ['pending', 'approved', 'changes_requested', 'cancelled'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** A request for one person to look at one section. The comments themselves live in the shared Comment model. */
@Schema({ timestamps: true })
export class ProposalReview extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Proposal', required: true, index: true })
  proposalId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ProposalSection', required: true, index: true })
  sectionId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  requestedBy!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  reviewerId!: mongoose.Types.ObjectId;

  /** What the requester wants looked at. */
  @Prop({ trim: true, maxlength: 500 })
  note?: string;

  @Prop({ type: String, enum: REVIEW_STATUSES, default: 'pending' })
  status!: ReviewStatus;

  /** The reviewer's overall answer. */
  @Prop({ trim: true, maxlength: 1000 })
  response?: string;

  @Prop({ type: Date })
  respondedAt?: Date;
}

export const ProposalReviewSchema = SchemaFactory.createForClass(ProposalReview);
// "reviews waiting for me"
ProposalReviewSchema.index({ reviewerId: 1, status: 1 });
