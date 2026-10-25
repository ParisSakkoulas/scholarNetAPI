import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const REACTION_TYPES = ['like', 'celebrate', 'support', 'love', 'insightful', 'funny'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

/** A "like" is a reaction; older rows have no type and count as plain likes. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class PostLike extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true })
  post!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  user!: mongoose.Types.ObjectId;

  @Prop({ type: String, enum: REACTION_TYPES, default: 'like' })
  type!: ReactionType;
}

export const PostLikeSchema = SchemaFactory.createForClass(PostLike);

// one like per user per post; also serves "which of these posts did I like"
PostLikeSchema.index({ post: 1, user: 1 }, { unique: true });
PostLikeSchema.index({ user: 1, post: 1 });
