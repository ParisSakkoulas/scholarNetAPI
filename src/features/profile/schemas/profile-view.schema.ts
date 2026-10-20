// features/profile/schemas/profile-view.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** One row per (profile, viewer, day) — what lets the view counter ignore refreshes. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ProfileView extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  profile!: mongoose.Types.ObjectId;

  /** `u:<userId>` for signed-in viewers, `ip:<address>` for anonymous ones. */
  @Prop({ required: true })
  viewer!: string;

  /** UTC day, YYYY-MM-DD. */
  @Prop({ required: true })
  day!: string;
}

export const ProfileViewSchema = SchemaFactory.createForClass(ProfileView);
ProfileViewSchema.index({ profile: 1, viewer: 1, day: 1 }, { unique: true });
// the day key makes old rows useless, so let Mongo drop them
ProfileViewSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
