import { IsString, IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class PositionDto {
  @IsString()
  title!: string;

  @IsString()
  institution!: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsDateString()
  startDate!: Date;

  @IsOptional()
  @IsDateString()
  endDate?: Date;

  @IsOptional()
  @IsBoolean()
  current?: boolean;
}
