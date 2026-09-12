import { IsString, MaxLength, Matches, IsOptional, IsIn } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional() @IsIn(['public', 'private']) visibility?: string;
}
