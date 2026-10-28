import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const PROPOSAL_STATUSES = ['planning', 'writing', 'review', 'submitted', 'awarded', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** For each reminder, the deadline it was last sent for. A changed deadline makes it due again. */
@Schema({ _id: false })
export class ProposalReminders {
  @Prop({ type: Date, default: null }) official14?: Date | null;
  @Prop({ type: Date, default: null }) official3?: Date | null;
  @Prop({ type: Date, default: null }) internal3?: Date | null;
}
const ProposalRemindersSchema = SchemaFactory.createForClass(ProposalReminders);

/** A researcher's (or a team's) application to one grant call. The writing itself happens in their own tools. */
@Schema({ timestamps: true })
export class Proposal extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'GrantCall', required: true, index: true })
  callId!: mongoose.Types.ObjectId;

  /** Set = a team proposal, visible to the team's members. Unset = personal, visible to the owner only. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Team', index: true })
  teamId?: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId!: mongoose.Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, enum: PROPOSAL_STATUSES, default: 'planning' })
  status!: ProposalStatus;

  /** The team's own target, before the funder's deadline. */
  @Prop({ type: Date })
  internalDeadline?: Date;

  /** The Kanban project and board created for a team proposal. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Project' })
  projectId?: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Board' })
  boardId?: mongoose.Types.ObjectId;

  /** What happened: a word on the result, for the team's own records. */
  @Prop({ trim: true, maxlength: 1000 })
  outcomeNote?: string;

  /** When it was marked submitted, and when it was awarded or turned down. */
  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Date })
  decidedAt?: Date;

  @Prop({ type: ProposalRemindersSchema, default: () => ({}) })
  reminders!: ProposalReminders;
}

export const ProposalSchema = SchemaFactory.createForClass(Proposal);
