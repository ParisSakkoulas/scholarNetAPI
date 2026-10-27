import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** Kept for the moderation queue (phase 4). */
@Schema({ timestamps: true })
export class CircleReport extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Circle', required: true, index: true })
  circleId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  reporterId!: mongoose.Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 1000 })
  reason!: string;

  @Prop({ type: String, enum: ['open', 'dismissed', 'actioned'], default: 'open' })
  status!: 'open' | 'dismissed' | 'actioned';
}

export const CircleReportSchema = SchemaFactory.createForClass(CircleReport);
// one report per person per circle
CircleReportSchema.index({ circleId: 1, reporterId: 1 }, { unique: true });
