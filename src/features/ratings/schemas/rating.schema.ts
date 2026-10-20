import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export enum RatingTarget {
  PUBLICATION = 'publication',
}

/** One document per "rater gave target N stars". */
@Schema({ timestamps: true })
export class Rating extends Document {
  @Prop({ type: String, enum: Object.values(RatingTarget), required: true })
  targetType!: RatingTarget;

  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
  target!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  rater!: mongoose.Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  value!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const RatingSchema = SchemaFactory.createForClass(Rating);

// one rating per user per target; also serves "my rating" lookups and the average aggregation
RatingSchema.index({ targetType: 1, target: 1, rater: 1 }, { unique: true });
