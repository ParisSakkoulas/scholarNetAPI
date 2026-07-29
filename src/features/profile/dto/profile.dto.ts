// features/profile/dto/create-profile.dto.ts
import { IsString, IsOptional, MaxLength, IsUrl, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PositionDto } from './position.dto';
import { EducationDto } from './education.dto';
import { SkillDto } from './skill.dto';
import { InterestDto } from './interest.dto';
import { PinnedItemDto } from './pinned-item';
import { LinkDto } from './link.dto';

/**
 * Fields intentionally EXCLUDED from create/update:
 * - `user` — set from the authenticated request, never client-supplied
 * - `verified` — set by an admin/verification flow, not self-service
 * - `profileViews`, `citationCount`, `hIndex`, `i10Index`, `yearlyPublications`
 *   — these are cached/derived stats (per your Statistics & Metrics spec),
 *   recalculated by a job or service, not written by the profile edit form
 */
export class CreateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  orcidId?: string;

  @IsOptional()
  @IsString()
  googleScholarId?: string;

  @IsOptional()
  @IsString()
  scopusId?: string;

  @IsOptional()
  @IsString()
  researcherId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PositionDto)
  positions?: PositionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EducationDto)
  education?: EducationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillDto)
  skills?: SkillDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterestDto)
  interests?: InterestDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PinnedItemDto)
  pinnedItems?: PinnedItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkDto)
  links?: LinkDto[];
}
