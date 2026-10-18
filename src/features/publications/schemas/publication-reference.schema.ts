import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export enum ReferenceSource {
  OPENALEX = 'openalex',
  CROSSREF = 'crossref',
  MANUAL = 'manual',
  BIBTEX = 'bibtex',
}

export enum ReferenceStatus {
  RESOLVED = 'resolved',
  UNRESOLVED = 'unresolved',
}

@Schema({ _id: false })
export class ReferenceSnapshot {
  @Prop() title?: string;
  @Prop({ type: [String], default: undefined }) authors?: string[];
  @Prop() year?: number;
  @Prop() doi?: string;
  @Prop() openalexId?: string;
  @Prop() venue?: string;
}
export const ReferenceSnapshotSchema = SchemaFactory.createForClass(ReferenceSnapshot);

/**
 * An edge "citing -> cited". Kept outside the publication because most cited works are not on
 * scholarNet and because "cited by" needs the reverse lookup.
 */
@Schema({ timestamps: true })
export class PublicationReference extends Document {
  /** The publication that contains this reference in its list. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Publication', required: true })
  citing!: mongoose.Types.ObjectId;

  /** Set only when the cited work exists on scholarNet. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Publication', default: null })
  cited?: mongoose.Types.ObjectId | null;

  /** Dedupe key: doi:<doi> > oa:<openalexId> > h:<hash(title+year+first author)>. */
  @Prop({ required: true })
  key!: string;

  @Prop({ default: 0 })
  position!: number;

  /** Original citation string, if imported from text/BibTeX. */
  @Prop()
  raw?: string;

  @Prop({ type: ReferenceSnapshotSchema })
  snapshot?: ReferenceSnapshot;

  @Prop({ type: String, enum: Object.values(ReferenceSource), required: true })
  source!: ReferenceSource;

  /** The user edited/added it, so a sync must not overwrite it. */
  @Prop({ default: false })
  locked!: boolean;

  @Prop({ type: String, enum: Object.values(ReferenceStatus), default: ReferenceStatus.UNRESOLVED })
  status!: ReferenceStatus;

  createdAt!: Date;
}

export const PublicationReferenceSchema = SchemaFactory.createForClass(PublicationReference);

// idempotent imports
PublicationReferenceSchema.index({ citing: 1, key: 1 }, { unique: true });
PublicationReferenceSchema.index({ citing: 1, position: 1 });
// "cited by" queries
PublicationReferenceSchema.index({ cited: 1 });
// resolving old unresolved edges when a matching publication is added later
PublicationReferenceSchema.index({ 'snapshot.doi': 1 }, { sparse: true });
PublicationReferenceSchema.index({ 'snapshot.openalexId': 1 }, { sparse: true });
