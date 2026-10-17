import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** One document per "A follows B" relationship. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Follow extends Document {
  /** The user who follows. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  follower!: mongoose.Types.ObjectId;

  /** The user being followed (owner of the profile). */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  following!: mongoose.Types.ObjectId;

  createdAt!: Date;
}

export const FollowSchema = SchemaFactory.createForClass(Follow);

// a user can follow another user only once
FollowSchema.index({ follower: 1, following: 1 }, { unique: true });
// "followers of X" and "who does X follow" lists, newest first
FollowSchema.index({ following: 1, createdAt: -1 });
FollowSchema.index({ follower: 1, createdAt: -1 });
