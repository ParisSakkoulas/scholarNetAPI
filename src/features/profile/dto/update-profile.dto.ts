import { IsString, IsOptional, MaxLength, Matches, IsArray } from 'class-validator';
import { CreateProfileDto } from './profile.dto';

export class UpdateProfileDto extends CreateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availability?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/, {
    message: 'orcidId must match the format 0000-0000-0000-0000',
  })
  orcidId?: string;
}
