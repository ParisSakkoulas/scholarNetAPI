import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const GRANT_SAVE_STATES = ['saved', 'dismissed'] as const;
export type GrantSaveState = (typeof GRANT_SAVE_STATES)[number];

/** A user's own mark on a call: saved for later, or dismissed so it stops showing up. */
@Schema({ timestamps: true })
export class GrantSave extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'GrantCall', required: true })
  callId!: mongoose.Types.ObjectId;

  @Prop({ type: String, enum: GRANT_SAVE_STATES, required: true })
  state!: GrantSaveState;

  /** Last deadline reminder sent for this saved call (14 or 3 days out); null = none yet. */
  @Prop({ type: Number, default: null })
  lastDeadlineAlert?: number | null;
}

export const GrantSaveSchema = SchemaFactory.createForClass(GrantSave);
// one mark per user per call
GrantSaveSchema.index({ userId: 1, callId: 1 }, { unique: true });
