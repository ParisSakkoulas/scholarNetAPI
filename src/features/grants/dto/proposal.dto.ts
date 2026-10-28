import { Type } from 'class-transformer';
import { IsDate, IsIn, IsMongoId, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { SanitizeHtml } from '../../../common/decorators/sanitize-html.decorator';
import { PROPOSAL_STATUSES } from '../schemas/proposal.schema';
import { SECTION_STATUSES } from '../schemas/proposal-section.schema';

/** Skips the other validators when the value is `null`, which means "clear this field". */
const Nullable = () => ValidateIf((_o, v) => v !== null);

export class StartProposalDto {
  /** Defaults to the call's title. */
  @SanitizeHtml() @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;

  /** A team the proposal belongs to. Leave out for a personal proposal. */
  @IsOptional() @IsMongoId() teamId?: string;

  @IsOptional() @Type(() => Date) @IsDate() internalDeadline?: Date;
}

export class UpdateProposalDto {
  @SanitizeHtml() @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;

  @IsOptional() @IsIn(PROPOSAL_STATUSES as unknown as string[]) status?: string;

  /** A word on the outcome (submitted, awarded, not funded). `null` clears it. */
  @IsOptional() @Nullable() @SanitizeHtml() @IsString() @MaxLength(1000) outcomeNote?: string | null;

  /** `null` removes the internal deadline. */
  @IsOptional() @Nullable() @Type(() => Date) @IsDate() internalDeadline?: Date | null;
}

export class CreateSectionDto {
  @SanitizeHtml() @IsString() @MinLength(2) @MaxLength(120) title!: string;

  @IsOptional() @Type(() => Date) @IsDate() dueDate?: Date;
}

export class UpdateSectionDto {
  @SanitizeHtml() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;

  @IsOptional() @IsIn(SECTION_STATUSES as unknown as string[]) status?: string;

  /** A team member. `null` unassigns. */
  @IsOptional() @Nullable() @IsMongoId() ownerId?: string | null;

  /** Must not be after the funder's deadline. `null` removes it. */
  @IsOptional() @Nullable() @Type(() => Date) @IsDate() dueDate?: Date | null;
}

export class RequestReviewDto {
  /** A teammate, or one of the caller's supervisors. */
  @IsMongoId() reviewerId!: string;

  /** What to look at. */
  @SanitizeHtml() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RespondReviewDto {
  @IsIn(['approve', 'changes']) decision!: 'approve' | 'changes';

  @SanitizeHtml() @IsOptional() @IsString() @MaxLength(1000) response?: string;
}

export class CommentDto {
  @SanitizeHtml() @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}
