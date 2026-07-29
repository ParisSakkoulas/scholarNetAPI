// features/profile/schemas/profile.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import {
  Education,
  EducationSchema,
  Position,
  PositionSchema,
  Skill,
  SkillSchema,
  Interest,
  InterestSchema,
  PinnedItemSchema,
  PinnedItem,
  LinkSchema,
  Link,
} from './profile-sub.schema';

@Schema({ timestamps: true })
export class Profile extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  user!: mongoose.Types.ObjectId;

  @Prop({ trim: true })
  headline?: string;

  @Prop({ trim: true, maxlength: 2000 })
  bio?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  timezone?: string;

  @Prop({ trim: true })
  website?: string;

  @Prop({ trim: true })
  country?: string;

  @Prop({ trim: true })
  orcidId?: string;

  @Prop({ trim: true })
  googleScholarId?: string;

  @Prop({ trim: true })
  scopusId?: string;

  @Prop({ trim: true })
  researcherId?: string;

  @Prop({ default: false })
  verified!: boolean;

  @Prop({ type: [PositionSchema], default: [] })
  positions!: Position[];

  @Prop({ type: [EducationSchema], default: [] })
  education!: Education[];

  @Prop({ type: [SkillSchema], default: [] })
  skills!: Skill[];

  @Prop({ type: [InterestSchema], default: [] })
  interests!: Interest[];

  @Prop({ type: [PinnedItemSchema], default: [] })
  pinnedItems!: PinnedItem[];

  @Prop({ type: [String], default: [] })
  languages?: string[];

  @Prop({ type: [String], default: [] })
  availability?: string[];

  @Prop({ type: [LinkSchema], default: [] })
  links?: Link[];

  // ---- statistics (mostly derived/cached) ----
  @Prop({ default: 0 })
  profileViews!: number;

  @Prop({ default: 0 })
  citationCount!: number;

  @Prop({ default: 0 })
  hIndex!: number;

  @Prop({ default: 0 })
  i10Index!: number;

  @Prop({
    type: [{ year: Number, count: Number }],
    default: [],
    _id: false,
  })
  yearlyPublications!: { year: number; count: number }[];
}

export const ProfileSchema = SchemaFactory.createForClass(Profile);
