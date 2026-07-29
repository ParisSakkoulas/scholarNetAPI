import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class SkillDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  endorsementCount?: number;
}
