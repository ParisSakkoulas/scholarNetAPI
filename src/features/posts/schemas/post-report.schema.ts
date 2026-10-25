import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const REPORT_REASONS = ['spam', 'harassment', 'misinformation', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A user flagging someone else's post for review. One report per user per post. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class PostReport extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true })
  post!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  reporter!: mongoose.Types.ObjectId;

  @Prop({ type: String, enum: REPORT_REASONS, required: true })
  reason!: ReportReason;

  @Prop({ type: String, trim: true, maxlength: 1000, default: '' })
  details?: string;
}

export const PostReportSchema = SchemaFactory.createForClass(PostReport);
PostReportSchema.index({ post: 1, reporter: 1 }, { unique: true });
