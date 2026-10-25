import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** A successful lookup in an external source, kept by DOI so the same DOI is not fetched twice. */
@Schema({ timestamps: true })
export class SourceCache extends Document {
  @Prop({ required: true })
  source!: string;

  @Prop({ required: true })
  doi!: string;

  /** The `ImportDraft` as the source returned it. */
  @Prop({ type: Object, required: true })
  draft!: Record<string, unknown>;

  @Prop({ required: true })
  expiresAt!: Date;
}

export const SourceCacheSchema = SchemaFactory.createForClass(SourceCache);

SourceCacheSchema.index({ source: 1, doi: 1 }, { unique: true });
// MongoDB removes the entry once `expiresAt` has passed
SourceCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
