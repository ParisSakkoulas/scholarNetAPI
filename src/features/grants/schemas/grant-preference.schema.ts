import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** What a researcher is looking for. One per user; drives the "For you" list and the alerts. */
@Schema({ timestamps: true })
export class GrantPreference extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: mongoose.Types.ObjectId;

  /** ISO alpha-2. Empty = no country filter. */
  @Prop({ type: [String], default: [] })
  countries!: string[];

  @Prop({ type: String })
  careerStage?: string;

  @Prop({ type: [String], default: [] })
  fields!: string[];

  @Prop({ type: [String], default: [] })
  fundingTypes!: string[];

  /** Off = no grant notifications of any kind (new matches, deadlines, edits). */
  @Prop({ default: true })
  alertsEnabled!: boolean;
}

export const GrantPreferenceSchema = SchemaFactory.createForClass(GrantPreference);
