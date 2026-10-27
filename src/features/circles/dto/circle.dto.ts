import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
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
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SanitizeHtml } from '../../../common/decorators/sanitize-html.decorator';
import { CIRCLE_STAGES, CIRCLE_VISIBILITIES, HARD_MAX_MEMBERS } from '../schemas/circle.schema';
import { SESSION_RESULTS } from '../schemas/circle-session.schema';
import { isValidTimezone } from '../util/schedule.util';

@ValidatorConstraint({ name: 'ianaTimezone', async: false })
class IanaTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isValidTimezone(value);
  }
  defaultMessage() {
    return 'timezone must be a valid IANA time zone, e.g. "Europe/Athens"';
  }
}

export class ScheduleDto {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be "HH:mm" (24 hour)' })
  time!: string;

  @IsInt()
  @Min(15)
  @Max(240)
  durationMin!: number;

  @Validate(IanaTimezoneConstraint)
  timezone!: string;
}

export class CreateCircleDto {
  @SanitizeHtml()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @SanitizeHtml()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @SanitizeHtml()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  field!: string;

  @IsIn(CIRCLE_STAGES as unknown as string[])
  stage!: string;

  @IsOptional()
  @IsIn(CIRCLE_VISIBILITIES as unknown as string[])
  visibility?: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(HARD_MAX_MEMBERS)
  maxMembers?: number;

  @ValidateNested()
  @Type(() => ScheduleDto)
  schedule!: ScheduleDto;

  /** Zoom, Meet, Jitsi... The platform does not host video. */
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'meetingUrl must be an http(s) link' })
  @MaxLength(500)
  meetingUrl?: string;
}

export class UpdateCircleDto extends PartialType(CreateCircleDto) {}

/** An empty query value (`?stage=`) means "no filter", not an invalid value. */
const EmptyToUndefined = () =>
  Transform(({ value }) => (value === '' || value === null ? undefined : value));

export class ListCirclesQuery {
  @EmptyToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @EmptyToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;

  @EmptyToUndefined() @IsOptional() @IsString() @MaxLength(100) field?: string;
  @EmptyToUndefined() @IsOptional() @IsIn(CIRCLE_STAGES as unknown as string[]) stage?: string;
  @EmptyToUndefined() @IsOptional() @IsIn(CIRCLE_VISIBILITIES as unknown as string[]) visibility?: string;
  /** Only circles that meet in this IANA time zone. */
  @EmptyToUndefined() @IsOptional() @IsString() @MaxLength(60) timezone?: string;
}

export class UpdateMemberDto {
  @IsIn(['approve', 'remove'])
  action!: 'approve' | 'remove';
}

export class GoalDto {
  @SanitizeHtml()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  goal!: string;
}

export class CheckoutDto {
  @IsIn(SESSION_RESULTS as unknown as string[])
  result!: string;

  @SanitizeHtml()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateSessionDto {
  @IsIn(['cancelled', 'done'])
  status!: 'cancelled' | 'done';
}

export class ReportCircleDto {
  @SanitizeHtml()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}
