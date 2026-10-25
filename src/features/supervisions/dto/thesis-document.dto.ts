import {
  IsIn,
  IsInt,
  IsObject,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SanitizeHtml } from '../../../common/decorators/sanitize-html.decorator';
import { DOCUMENT_STATUSES, DocumentStatus } from '../schemas/thesis-document.schema';

export class CreateDocumentDto {
  @SanitizeHtml()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsMongoId()
  milestoneId?: string;

  @IsOptional()
  @IsMongoId()
  meetingId?: string;

  /** Phase 1 only has upload mode. */
  @IsOptional()
  @IsIn(['upload'])
  mode?: 'upload';
}

export class UploadVersionDto {
  @IsOptional()
  @SanitizeHtml()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateDocumentStatusDto {
  @IsIn(DOCUMENT_STATUSES)
  status!: DocumentStatus;
}

export class CreateWorkspaceDto {
  @IsOptional()
  @SanitizeHtml()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
}

export class SaveDraftDto {
  /** Validated and rebuilt by sanitizeEditorContent in the service. */
  @IsObject()
  content!: Record<string, unknown>;

  /** The revision the editor last saw; a mismatch means another tab saved in between. */
  @IsInt()
  @Min(0)
  baseRevision!: number;
}

export class AnchorDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  from?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  to?: number;

  /** The selected text (editor comments). */
  @IsOptional()
  @SanitizeHtml()
  @IsString()
  @MaxLength(500)
  quote?: string;

  /**
   * Text around the quote, used only to find it again after edits. Never rendered, and kept
   * untrimmed on purpose (the spaces matter for matching), so no sanitizing transform here.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  before?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  after?: string;
}

export class CreateCommentDto {
  @SanitizeHtml()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  /** Defaults to the current version. */
  @IsOptional()
  @IsMongoId()
  versionId?: string;

  /** Makes this a reply to a top-level comment. */
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnchorDto)
  anchor?: AnchorDto;
}

export class ResolveCommentDto {
  @IsIn(['open', 'resolved'])
  status!: 'open' | 'resolved';
}
