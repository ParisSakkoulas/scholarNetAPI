import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { AccessRequestStatus } from 'src/common/enums/file-access.enum';

/** "May I download this file?" - one per (file, requester); the uploader approves or rejects. */
@Schema({ timestamps: true })
export class FileAccessRequest extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Publication', required: true })
  publication!: mongoose.Types.ObjectId;

  /** _id of the entry inside publication.files */
  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
  fileId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  requester!: mongoose.Types.ObjectId;

  /** The uploader, who decides. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  owner!: mongoose.Types.ObjectId;

  /** Snapshots so request lists need no join with publications. */
  @Prop({ required: true }) publicationTitle!: string;
  @Prop({ required: true }) fileName!: string;

  @Prop({ trim: true, maxlength: 500 })
  message?: string;

  @Prop({
    type: String,
    enum: Object.values(AccessRequestStatus),
    default: AccessRequestStatus.PENDING,
  })
  status!: AccessRequestStatus;

  @Prop({ type: Date, default: null })
  decidedAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FileAccessRequestSchema = SchemaFactory.createForClass(FileAccessRequest);

FileAccessRequestSchema.index({ fileId: 1, requester: 1 }, { unique: true });
FileAccessRequestSchema.index({ owner: 1, status: 1, createdAt: -1 });
FileAccessRequestSchema.index({ requester: 1, createdAt: -1 });
