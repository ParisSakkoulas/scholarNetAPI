import { IsString, IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class PositionDto {
  @IsString()
  title!: string;

  @IsString()
  institution!: string;

  @IsString()
  department!: string;

  @IsOptional()
  @IsDateString()
  startDate?: Date;

  @IsOptional()
  @IsDateString()
  endDate?: Date;

  @IsOptional()
  @IsBoolean()
  current?: boolean;
}
