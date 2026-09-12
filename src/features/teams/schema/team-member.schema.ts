import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type TeamMemberDocument = TeamMember & Document;

@Schema({
  timestamps: true,
})
export class TeamMember {
  @Prop({ type: Types.ObjectId, ref: 'Team', required: true, index: true })
  teamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ enum: ['owner', 'admin', 'member', 'viewer'], default: 'member' })
  role!: string;

  @Prop({ enum: ['active', 'invited', 'removed'], default: 'invited' })
  status!: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  invitedBy?: Types.ObjectId;
  @Prop() joinedAt?: Date;
}
export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);
TeamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
