import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const COMMENT_STATUSES = ['open', 'resolved'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/** Named DocumentComment: the tasks feature already registers a model called "Comment". */
@Schema({ timestamps: true })
export class DocumentComment extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ThesisDocument', required: true })
  documentId!: mongoose.Types.ObjectId;

  /** The uploaded version the comment is about; null on the live draft of an editor document. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'DocumentVersion', default: null })
  versionId?: mongoose.Types.ObjectId | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  authorId!: mongoose.Types.ObjectId;

  /** Plain text, sanitized on the way in. */
  @Prop({ required: true, trim: true, maxlength: 4000 })
  text!: string;

  /** Set on replies; points to the top-level comment of the thread. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'DocumentComment', default: null })
  parentId?: mongoose.Types.ObjectId | null;

  /**
   * Where in the document: a PDF page, or an editor text range. `quote` is the selected text; the
   * client re-finds it after edits, and a comment whose quote is gone is shown as outdated.
   */
  @Prop({
    type: { page: Number, from: Number, to: Number, quote: String, before: String, after: String },
    default: null,
    _id: false,
  })
  anchor?: {
    page?: number;
    from?: number;
    to?: number;
    quote?: string;
    before?: string;
    after?: string;
  } | null;

  @Prop({ type: String, enum: COMMENT_STATUSES, default: 'open' })
  status!: CommentStatus;
}

export const DocumentCommentSchema = SchemaFactory.createForClass(DocumentComment);
DocumentCommentSchema.index({ documentId: 1, versionId: 1, status: 1 });
DocumentCommentSchema.index({ parentId: 1 });
