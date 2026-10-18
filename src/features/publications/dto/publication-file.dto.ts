import { IsDateString, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FileAccessMode } from 'src/common/enums/file-access.enum';
import { PublicationFileRole } from '../schemas/publication.schema';

/** Multipart fields sent next to the `file` part. */
export class UploadPublicationFileDto {
  /** Defaults to "fulltext" for PDFs and "slides" for presentations. */
  @IsOptional()
  @IsEnum(PublicationFileRole)
  role?: PublicationFileRole;

  /** Defaults to "public". */
  @IsOptional()
  @IsEnum(FileAccessMode)
  accessMode?: FileAccessMode;

  @IsOptional()
  @IsIn(['preprint', 'accepted', 'published'])
  version?: string;

  @IsOptional()
  @IsDateString()
  embargoUntil?: string;
}

export class UpdatePublicationFileDto {
  @IsOptional()
  @IsEnum(PublicationFileRole)
  role?: PublicationFileRole;

  @IsOptional()
  @IsEnum(FileAccessMode)
  accessMode?: FileAccessMode;

  @IsOptional()
  @IsIn(['preprint', 'accepted', 'published'])
  version?: string;

  /** Send an empty string to remove the embargo. */
  @IsOptional()
  @IsString()
  embargoUntil?: string;
}

export class RequestFileAccessDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class DecideFileAccessDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';
}
