import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ColumnDocument = Column & Document;

@Schema({ timestamps: true })
export class Column {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true, index: true })
  boardId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 60 })
  name!: string;

  @Prop({ required: true })
  position!: number;

  @Prop()
  wipLimit?: number;
}

export const ColumnSchema = SchemaFactory.createForClass(Column);
