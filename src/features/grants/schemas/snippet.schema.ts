import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const SNIPPET_TYPES = ['bio', 'institution', 'budget_line', 'ethics', 'other'] as const;
export type SnippetType = (typeof SNIPPET_TYPES)[number];

/** Reusable text for grant applications: a bio, an institution description, a budget line... */
@Schema({ timestamps: true })
export class Snippet extends Document {
  /** Who created it. A personal snippet belongs to them alone. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId!: mongoose.Types.ObjectId;

  /** Set = shared with that team's members. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Team', index: true })
  teamId?: mongoose.Types.ObjectId;

  @Prop({ type: String, enum: SNIPPET_TYPES, default: 'other' })
  type!: SnippetType;

  @Prop({ required: true, trim: true, maxlength: 120 })
  title!: string;

  @Prop({ required: true, trim: true, maxlength: 5000 })
  content!: string;
}

export const SnippetSchema = SchemaFactory.createForClass(Snippet);
