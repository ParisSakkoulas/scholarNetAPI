import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { PublicationType } from 'src/common/enums/publication-type.enum';
import { FileAccessMode } from 'src/common/enums/file-access.enum';

export enum PublicationVisibility {
  PUBLIC = 'public',
  FOLLOWERS = 'followers',
  PRIVATE = 'private',
}

export enum PublicationFileRole {
  FULLTEXT = 'fulltext',
  SUPPLEMENTARY = 'supplementary',
  SLIDES = 'slides',
  POSTER = 'poster',
  DATA = 'data',
  OTHER = 'other',
}

// ---------------- SUBDOCUMENTS ----------------

@Schema({ _id: false })
export class PublicationAuthor {
  /** Set when the author is a scholarNet user. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null })
  user?: mongoose.Types.ObjectId | null;

  /** Always stored: co-authors are often not on the platform. */
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  affiliation?: string;

  @Prop({ trim: true })
  orcid?: string;

  @Prop({ required: true })
  order!: number;

  @Prop({ default: false })
  isCorresponding?: boolean;

  /** True once the linked user accepted the authorship. */
  @Prop({ default: false })
  confirmed?: boolean;
}
export const PublicationAuthorSchema = SchemaFactory.createForClass(PublicationAuthor);

@Schema({ _id: false })
export class PublicationIdentifiers {
  @Prop() doi?: string;
  @Prop() isbn?: string;
  @Prop() issn?: string;
  @Prop() arxivId?: string;
  @Prop() pmid?: string;
  @Prop() patentNumber?: string;
  @Prop() handle?: string;
  @Prop() openalexId?: string;
}
export const PublicationIdentifiersSchema = SchemaFactory.createForClass(PublicationIdentifiers);

@Schema()
export class PublicationFile {
  @Prop({ type: String, enum: Object.values(PublicationFileRole), required: true })
  role!: PublicationFileRole;

  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) mimeType!: string;
  @Prop({ required: true }) size!: number;
  @Prop({ required: true }) storageKey!: string;

  @Prop({ type: String, enum: ['preprint', 'accepted', 'published'] })
  version?: string;

  /** Until this date nobody but the uploader can download it. */
  @Prop({ type: Date }) embargoUntil?: Date;

  /** public: anyone | approval_based: others must request access | restricted: only the uploader */
  @Prop({
    type: String,
    enum: Object.values(FileAccessMode),
    default: FileAccessMode.PUBLIC,
    required: true,
  })
  accessMode!: FileAccessMode;

  @Prop({ type: Date, default: Date.now }) uploadedAt?: Date;
}
export const PublicationFileSchema = SchemaFactory.createForClass(PublicationFile);

@Schema({ _id: false })
export class PublicationMetrics {
  @Prop({ default: 0 }) views!: number;
  @Prop({ default: 0 }) downloads!: number;
  @Prop({ default: 0 }) citations!: number;
  @Prop({ default: 0 }) reads!: number;
  /** Cached from the ratings collection (1-5 stars). */
  @Prop({ default: 0 }) ratingAvg!: number;
  @Prop({ default: 0 }) ratingCount!: number;
}
export const PublicationMetricsSchema = SchemaFactory.createForClass(PublicationMetrics);

// ---------------- BASE ----------------

@Schema({ timestamps: true, discriminatorKey: 'type' })
export class Publication extends Document {
  @Prop({ type: String, required: true, enum: Object.values(PublicationType) })
  type!: PublicationType;

  @Prop({ required: true, trim: true, maxlength: 500 })
  title!: string;

  @Prop({ trim: true })
  abstract?: string;

  @Prop({ type: [PublicationAuthorSchema], default: [] })
  authors!: PublicationAuthor[];

  @Prop({ required: true, min: 1800 })
  year!: number;

  @Prop({ type: Date })
  publishedAt?: Date;

  /** ISO 639-1 */
  @Prop({ trim: true, lowercase: true })
  language?: string;

  @Prop({ type: [String], default: [] })
  keywords!: string[];

  /** Research areas / subjects */
  @Prop({ type: [String], default: [] })
  fields!: string[];

  @Prop({ type: PublicationIdentifiersSchema, default: {} })
  identifiers!: PublicationIdentifiers;

  @Prop({ trim: true })
  url?: string;

  @Prop({ type: [PublicationFileSchema], default: [] })
  files!: PublicationFile[];

  @Prop({
    type: String,
    enum: Object.values(PublicationVisibility),
    default: PublicationVisibility.PUBLIC,
    required: true,
  })
  visibility!: PublicationVisibility;

  @Prop({ trim: true })
  license?: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: mongoose.Types.ObjectId;

  @Prop({ type: PublicationMetricsSchema, default: () => ({}) })
  metrics!: PublicationMetrics;

  /** Reference keys the user deleted; an OpenAlex re-sync must not bring them back. */
  @Prop({ type: [String], default: [], select: false })
  removedReferenceKeys!: string[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const PublicationSchema = SchemaFactory.createForClass(Publication);

// `language_override` is pointed at an unused field: by default MongoDB reads our own
// `language` field (ISO code, e.g. "el") as the text-search language and rejects bad values.
PublicationSchema.index(
  { title: 'text', abstract: 'text', keywords: 'text' },
  { language_override: 'textSearchLanguage', default_language: 'none' },
);
PublicationSchema.index({ 'authors.user': 1, year: -1 });
PublicationSchema.index({ uploadedBy: 1, createdAt: -1 });
PublicationSchema.index({ type: 1, year: -1 });
// partialFilterExpression instead of `sparse`: identifiers is always present as a subdocument
PublicationSchema.index(
  { 'identifiers.doi': 1 },
  { unique: true, partialFilterExpression: { 'identifiers.doi': { $type: 'string' } } },
);
PublicationSchema.index({ fields: 1 });
PublicationSchema.index({ 'identifiers.openalexId': 1 });
