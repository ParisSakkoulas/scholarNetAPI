import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Add a reference by pointing to a scholarNet publication, a DOI, or typing its metadata. */
export class CreateReferenceDto {
  @IsOptional()
  @IsMongoId()
  citedPublicationId?: string;

  @IsOptional() @IsString() @MaxLength(200) doi?: string;
  @IsOptional() @IsString() @MaxLength(500) title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  authors?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(new Date().getFullYear() + 1)
  year?: number;

  @IsOptional() @IsString() @MaxLength(300) venue?: string;
  @IsOptional() @IsString() @MaxLength(3000) raw?: string;
}

/** Same metadata fields, all optional. Editing an edge locks it against re-sync. */
export class UpdateReferenceDto {
  @IsOptional() @IsString() @MaxLength(200) doi?: string;
  @IsOptional() @IsString() @MaxLength(500) title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  authors?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(new Date().getFullYear() + 1)
  year?: number;

  @IsOptional() @IsString() @MaxLength(300) venue?: string;
  @IsOptional() @IsString() @MaxLength(3000) raw?: string;
}

export class ImportReferencesDto {
  @IsIn(['bibtex', 'text'])
  format!: 'bibtex' | 'text';

  /** BibTeX source, or plain text with one reference per line. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200000)
  content!: string;
}
