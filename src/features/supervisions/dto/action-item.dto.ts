import { Type } from 'class-transformer';
import { IsDate, IsIn, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ACTION_ITEM_STATUSES, ActionItemStatus } from '../schemas/action-item.schema';

export class CreateActionItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  @IsMongoId()
  assigneeId!: string;

  @IsOptional()
  @IsMongoId()
  meetingId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;
}

export class UpdateActionItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text?: string;

  @IsOptional()
  @IsMongoId()
  assigneeId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @IsOptional()
  @IsIn(ACTION_ITEM_STATUSES)
  status?: ActionItemStatus;
}
