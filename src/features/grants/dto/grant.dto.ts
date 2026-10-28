import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SanitizeHtml, stripHtml } from '../../../common/decorators/sanitize-html.decorator';
import { FUNDING_TYPES, GRANT_STATUSES, CAREER_STAGES } from '../schemas/grant-call.schema';

/** Trims, strips HTML and drops empty entries from a list of short labels. */
const CleanList = () =>
  Transform(({ value }) =>
    Array.isArray(value)
      ? [...new Set(value.filter((v) => typeof v === 'string').map((v: string) => stripHtml(v)).filter(Boolean))]
      : value,
  );

const EmptyToUndefined = () =>
  Transform(({ value }) => (value === '' || value === null ? undefined : value));

export class AmountDto {
  @IsOptional() @IsInt() @Min(0) min?: number;
  @IsOptional() @IsInt() @Min(0) max?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code such as EUR' })
  currency!: string;
}

export class CreateGrantDto {
  @SanitizeHtml() @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @SanitizeHtml() @IsString() @MinLength(2) @MaxLength(150) funder!: string;

  /** The official call page. https only. */
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'url must be an https link to the official call page' })
  @MaxLength(1000)
  url!: string;

  @SanitizeHtml() @IsString() @MinLength(10) @MaxLength(4000) description!: string;

  /** ISO 3166 alpha-2 codes. Empty = eligible everywhere. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @CleanList()
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => String(v).toUpperCase()) : value))
  @Matches(/^[A-Z]{2}$/, { each: true, message: 'each country must be a 2-letter code such as GR' })
  countries?: string[];

  @IsOptional()
  @IsArray()
  @CleanList()
  @IsIn(CAREER_STAGES as unknown as string[], { each: true })
  careerStages?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @CleanList()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  fields?: string[];

  @IsIn(FUNDING_TYPES as unknown as string[]) fundingType!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AmountDto)
  amount?: AmountDto;

  @IsOptional() @Type(() => Date) @IsDate() opensAt?: Date;

  @Type(() => Date) @IsDate() deadline!: Date;

  /** When the record was last compared with the official page. Defaults to now. */
  @IsOptional() @Type(() => Date) @IsDate() lastCheckedAt?: Date;
}

export class UpdateGrantDto extends PartialType(CreateGrantDto) {}

export class ReviewGrantDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  /** Shown to the submitter. Worth filling in when rejecting. */
  @SanitizeHtml() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ListGrantsQuery {
  @EmptyToUndefined() @IsOptional() @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter code' }) country?: string;
  @EmptyToUndefined() @IsOptional() @IsIn(CAREER_STAGES as unknown as string[]) careerStage?: string;
  @EmptyToUndefined() @IsOptional() @IsString() @MaxLength(60) field?: string;
  @EmptyToUndefined() @IsOptional() @IsIn(FUNDING_TYPES as unknown as string[]) fundingType?: string;
  @EmptyToUndefined() @IsOptional() @Type(() => Date) @IsDate() deadlineFrom?: Date;
  @EmptyToUndefined() @IsOptional() @Type(() => Date) @IsDate() deadlineTo?: Date;
  @EmptyToUndefined() @IsOptional() @IsString() @MaxLength(100) search?: string;

  /** Closed calls are hidden unless asked for. */
  @EmptyToUndefined() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() includeClosed?: boolean;

  /** `all` (default, without dismissed calls), `saved` or `dismissed`: the caller's own marks. */
  @EmptyToUndefined() @IsOptional() @IsIn(['all', 'saved', 'dismissed']) tab?: 'all' | 'saved' | 'dismissed';

  /** Default `deadline` (soonest first). */
  @EmptyToUndefined() @IsOptional() @IsIn(['deadline', '-deadline', '-createdAt']) sort?: string;

  @EmptyToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @EmptyToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class PreferenceDto {
  /** ISO alpha-2 codes; empty = any country. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @CleanList()
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => String(v).toUpperCase()) : value))
  @Matches(/^[A-Z]{2}$/, { each: true, message: 'each country must be a 2-letter code such as GR' })
  countries?: string[];

  /** Null or empty clears it. */
  @EmptyToUndefined() @IsOptional() @IsIn(CAREER_STAGES as unknown as string[]) careerStage?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @CleanList()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  fields?: string[];

  @IsOptional()
  @IsArray()
  @CleanList()
  @IsIn(FUNDING_TYPES as unknown as string[], { each: true })
  fundingTypes?: string[];

  @IsOptional() @IsBoolean() alertsEnabled?: boolean;
}

export class MatchesQuery {
  @EmptyToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @EmptyToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

/** Moderator list: every status, with the generic table's paging and search. */
export class ManageGrantsQuery {
  @EmptyToUndefined() @IsOptional() @IsIn(GRANT_STATUSES as unknown as string[]) status?: string;
  @EmptyToUndefined() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @EmptyToUndefined() @IsOptional() @IsString() sortField?: string;
  @EmptyToUndefined() @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc';
  @EmptyToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @EmptyToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
