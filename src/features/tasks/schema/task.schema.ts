import { Prop, SchemaFactory, Schema } from '@nestjs/mongoose';
import { Types, Document } from 'mongoose';

export type TaskDocument = Task & Document;

@Schema({
  timestamps: true,
})
export class Task {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Column', required: true, index: true })
  columnId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Task', default: null, index: true })
  parentTaskId?: Types.ObjectId | null;

  @Prop({ required: true })
  title!: string;

  @Prop()
  description?: string;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  assigneeIds!: Types.ObjectId[];

  @Prop({ type: [String], default: [] })
  labels!: string[];

  @Prop({ enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' })
  priority!: string;

  @Prop()
  dueDate?: Date;

  @Prop({ required: true })
  position!: number;

  @Prop({ enum: ['todo', 'in_progress', 'done', 'blocked'], default: 'todo' })
  status!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  doneAt?: Date | null;
}
export const TaskSchema = SchemaFactory.createForClass(Task);
