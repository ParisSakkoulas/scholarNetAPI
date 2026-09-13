import { IsString, IsOptional, IsArray, IsMongoId, IsIn, IsDateString } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsMongoId()
  columnId!: string;

  @IsOptional()
  @IsMongoId()
  parentTaskId?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  assigneeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
