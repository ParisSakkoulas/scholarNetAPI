import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Message extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true })
  conversation!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  sender!: mongoose.Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 4000 })
  text!: string;

  /** Set when the other participant has read it. */
  @Prop({ type: Date, default: null })
  readAt?: Date | null;

  createdAt!: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// history pagination, newest first
MessageSchema.index({ conversation: 1, createdAt: -1 });
