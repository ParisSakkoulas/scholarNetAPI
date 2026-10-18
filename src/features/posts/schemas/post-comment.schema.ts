import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ timestamps: true })
export class PostComment extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true })
  post!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  author!: mongoose.Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 1000 })
  content!: string;

  createdAt!: Date;
}

export const PostCommentSchema = SchemaFactory.createForClass(PostComment);

PostCommentSchema.index({ post: 1, createdAt: -1 });
