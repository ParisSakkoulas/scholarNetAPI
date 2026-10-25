import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Post extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  author!: mongoose.Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 5000 })
  content!: string;

  // denormalized counters, kept in sync with atomic $inc — avoids counting on every feed read
  @Prop({ default: 0, min: 0 })
  likesCount!: number;

  @Prop({ default: 0, min: 0 })
  commentsCount!: number;

  /** set when the author changes the text after publishing */
  @Prop({ type: Date, default: null })
  editedAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PostSchema = SchemaFactory.createForClass(Post);

// feed + profile timelines
PostSchema.index({ author: 1, createdAt: -1 });
