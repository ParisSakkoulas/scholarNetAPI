import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** Immutable: versions are only ever added, never edited or deleted. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class DocumentVersion extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ThesisDocument', required: true, index: true })
  documentId!: mongoose.Types.ObjectId;

  /** 1, 2, 3... */
  @Prop({ type: Number, required: true })
  number!: number;

  @Prop({ type: String, trim: true, maxlength: 300, default: '' })
  note?: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: mongoose.Types.ObjectId;

  /** Who added it: the student's work, or a supervisor's reviewed copy. */
  @Prop({ type: String, enum: ['student', 'supervisor'], default: 'student' })
  byRole!: 'student' | 'supervisor';

  // ---- upload mode ----
  /** Opaque key in FileStorage; never sent to the client. */
  @Prop({ type: String, select: false })
  storageKey?: string;

  @Prop({ type: String })
  fileName?: string;

  @Prop({ type: String })
  mimeType?: string;

  @Prop({ type: Number })
  size?: number;

  // ---- editor mode (phase 3) ----
  @Prop({ type: mongoose.Schema.Types.Mixed })
  content?: Record<string, unknown>;
}

export const DocumentVersionSchema = SchemaFactory.createForClass(DocumentVersion);
DocumentVersionSchema.index({ documentId: 1, number: 1 }, { unique: true });
