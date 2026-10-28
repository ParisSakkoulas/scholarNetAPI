import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** A draft attached to a section. The bytes live in FileStorage under `storageKey`. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ProposalFile extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Proposal', required: true, index: true })
  proposalId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ProposalSection', required: true, index: true })
  sectionId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: mongoose.Types.ObjectId;

  /** Opaque key in FileStorage; never sent to the client. */
  @Prop({ type: String, required: true, select: false })
  storageKey!: string;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true })
  size!: number;
}

export const ProposalFileSchema = SchemaFactory.createForClass(ProposalFile);
