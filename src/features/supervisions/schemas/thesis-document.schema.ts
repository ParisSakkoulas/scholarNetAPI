import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const DOCUMENT_MODES = ['upload', 'editor'] as const;
export type DocumentMode = (typeof DOCUMENT_MODES)[number];

export const DOCUMENT_STATUSES = ['draft', 'ready_for_review', 'changes_requested', 'reviewed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** A piece of work the student shares inside a supervision, optionally tied to a milestone or meeting. */
@Schema({ timestamps: true })
export class ThesisDocument extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Supervision', required: true, index: true })
  supervisionId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Milestone', default: null })
  milestoneId?: mongoose.Types.ObjectId | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', default: null })
  meetingId?: mongoose.Types.ObjectId | null;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, enum: DOCUMENT_MODES, default: 'upload' })
  mode!: DocumentMode;

  @Prop({ type: String, enum: DOCUMENT_STATUSES, default: 'draft' })
  status!: DocumentStatus;

  /** Highest version number so far; bumped atomically, so numbers are never reused. */
  @Prop({ type: Number, default: 0 })
  currentVersion!: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: mongoose.Types.ObjectId;

  // ---- editor mode: the live working copy (versions are explicit snapshots of it) ----
  /** ProseMirror JSON, already sanitized. Not loaded unless asked for (it can be large). */
  @Prop({ type: mongoose.Schema.Types.Mixed, select: false })
  draftContent?: Record<string, unknown>;

  /** Bumped on every autosave; lets a second open tab be told it is out of date. */
  @Prop({ type: Number, default: 0 })
  draftRevision!: number;

  @Prop({ type: Date, default: null })
  draftUpdatedAt?: Date | null;
}

export const ThesisDocumentSchema = SchemaFactory.createForClass(ThesisDocument);
ThesisDocumentSchema.index({ supervisionId: 1, milestoneId: 1 });
// one co-working document per supervision
ThesisDocumentSchema.index(
  { supervisionId: 1, mode: 1 },
  { unique: true, partialFilterExpression: { mode: 'editor' } },
);
