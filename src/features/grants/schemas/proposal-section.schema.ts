import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export const SECTION_STATUSES = ['todo', 'writing', 'review', 'done'] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

/** One part of the application: abstract, work plan, budget... with an owner, a due date and attached drafts. */
@Schema({ timestamps: true })
export class ProposalSection extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Proposal', required: true, index: true })
  proposalId!: mongoose.Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 120 })
  title!: string;

  @Prop({ type: Number, required: true })
  position!: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  ownerId?: mongoose.Types.ObjectId;

  @Prop({ type: Date })
  dueDate?: Date;

  @Prop({ type: String, enum: SECTION_STATUSES, default: 'todo' })
  status!: SectionStatus;

  /** Attached drafts (ProposalFile). */
  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProposalFile' }], default: [] })
  fileIds!: mongoose.Types.ObjectId[];

  /** The Kanban card that mirrors this section on the team board. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Task' })
  taskId?: mongoose.Types.ObjectId;

  /** The due date a reminder was last sent for; a new due date makes it due again. */
  @Prop({ type: Date, default: null })
  dueRemindedFor?: Date | null;
}

export const ProposalSectionSchema = SchemaFactory.createForClass(ProposalSection);
ProposalSectionSchema.index({ proposalId: 1, position: 1 });
