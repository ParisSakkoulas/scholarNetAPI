import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Embedded sub-documents for Profile.
 * Each carries its own ObjectId (Mongoose adds _id by default to subdocs),
 * which the frontend uses as `id` for tracking/edit/delete.
 */

@Schema({ _id: true })
export class PinnedItem {
  @Prop({ required: true, maxlength: 40 })
  kind!: string;

  @Prop({ required: true, maxlength: 200 })
  title!: string;

  @Prop({ required: true, maxlength: 300 })
  detail!: string;
}
export const PinnedItemSchema = SchemaFactory.createForClass(PinnedItem);

@Schema({ _id: true })
export class Education {
  @Prop({ required: true, trim: true })
  degree!: string; // e.g. "PhD in Computational Linguistics"

  @Prop({ required: true, trim: true })
  institution!: string;

  @Prop({ required: true })
  startYear!: number;

  @Prop({ type: Number, default: null })
  endYear!: number | null;
}
export const EducationSchema = SchemaFactory.createForClass(Education);

@Schema({ _id: true })
export class Position {
  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  institution!: string;

  @Prop({ trim: true })
  department?: string;

  @Prop({ required: true })
  startDate?: Date;

  @Prop({ type: Date })
  endDate?: Date;

  @Prop({ default: false })
  current?: boolean;
}
export const PositionSchema = SchemaFactory.createForClass(Position);

@Schema({ _id: true })
export class Skill {
  @Prop({ required: true, trim: true })
  name!: string;

  // denormalized count — source of truth will move to a separate
  // Endorsement collection later; kept here for fast profile reads.
  @Prop({ default: 0 })
  endorsementCount!: number;
}
export const SkillSchema = SchemaFactory.createForClass(Skill);

@Schema({ _id: true })
export class Interest {
  @Prop({ required: true, trim: true })
  name!: string;
}
export const InterestSchema = SchemaFactory.createForClass(Interest);

@Schema({ _id: false })
export class Link {
  @Prop({ required: true, trim: true })
  type!: string;

  @Prop({ required: true, trim: true })
  url!: string;
}
export const LinkSchema = SchemaFactory.createForClass(Link);
