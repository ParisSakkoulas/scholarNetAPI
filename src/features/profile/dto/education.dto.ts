import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class EducationDto {
  @IsString()
  degree!: string;

  @IsString()
  institution!: string;

  @IsOptional()
  @IsString()
  fieldOfStudy?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  startYear?: number;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  endYear?: number;
}
