import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** A 1:1 conversation between two connected users. */
@Schema({ timestamps: true })
export class Conversation extends Document {
  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], required: true })
  participants!: mongoose.Types.ObjectId[];

  /** Sorted participant ids joined by "_"; makes "one conversation per pair" a unique index. */
  @Prop({ required: true })
  pairKey!: string;

  /** Denormalised preview so the conversation list needs no join with messages. */
  @Prop({
    type: {
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      text: String,
      createdAt: Date,
    },
    default: null,
    _id: false,
  })
  lastMessage?: { sender: mongoose.Types.ObjectId; text: string; createdAt: Date } | null;

  @Prop({ type: Date, default: Date.now })
  lastMessageAt!: Date;

  /** Unread message count per participant, keyed by user id. */
  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  unread!: Record<string, number>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.set('minimize', false);

ConversationSchema.index({ pairKey: 1 }, { unique: true });
// conversation list, most recent first
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });
