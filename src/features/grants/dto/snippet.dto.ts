import { Transform } from 'class-transformer';
import { IsIn, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SanitizeHtml } from '../../../common/decorators/sanitize-html.decorator';
import { SNIPPET_TYPES } from '../schemas/snippet.schema';

const EmptyToUndefined = () =>
  Transform(({ value }) => (value === '' || value === null ? undefined : value));

export class CreateSnippetDto {
  @IsIn(SNIPPET_TYPES as unknown as string[]) type!: string;

  @SanitizeHtml() @IsString() @MinLength(2) @MaxLength(120) title!: string;

  /** Plain text. Line breaks are kept; HTML is stripped. */
  @SanitizeHtml() @IsString() @MinLength(1) @MaxLength(5000) content!: string;

  /** Share with a team. Leave out for a personal snippet. */
  @IsOptional() @IsMongoId() teamId?: string;
}

/** The team cannot be changed afterwards: that would silently share or hide the text. */
export class UpdateSnippetDto {
  @IsOptional() @IsIn(SNIPPET_TYPES as unknown as string[]) type?: string;
  @SanitizeHtml() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @SanitizeHtml() @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) content?: string;
}

export class ListSnippetsQuery {
  @EmptyToUndefined() @IsOptional() @IsIn(SNIPPET_TYPES as unknown as string[]) type?: string;

  /** `personal`, or `team` for every team of mine, or one team's id. */
  @EmptyToUndefined() @IsOptional() @IsString() @MaxLength(30) scope?: string;

  @EmptyToUndefined() @IsOptional() @IsString() @MaxLength(100) search?: string;
}
