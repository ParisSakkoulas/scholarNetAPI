import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MILESTONE_STATUSES, MilestoneStatus } from '../schemas/milestone.schema';

export class CreateMilestoneDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;
}

export class UpdateMilestoneDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @IsOptional()
  @IsIn(MILESTONE_STATUSES)
  status?: MilestoneStatus;
}

export class ApplyTemplateDto {
  @IsOptional()
  @IsIn(['thesis'])
  template?: 'thesis';

  /** Due dates are spread from this day; defaults to today. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;
}
