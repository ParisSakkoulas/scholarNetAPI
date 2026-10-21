import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PublicationType } from 'src/common/enums/publication-type.enum';
import { PublicationVisibility } from '../schemas/publication.schema';

export class PublicationAuthorDto {
  @IsOptional()
  @IsMongoId()
  user?: string;

  /** Optional for scholarNet members: the server fills it from their account. */
  @ValidateIf((o: PublicationAuthorDto) => !o.user)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  affiliation?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, { message: 'orcid must look like 0000-0002-1825-0097' })
  orcid?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  isCorresponding?: boolean;
}

export class PublicationIdentifiersDto {
  @IsOptional() @IsString() doi?: string;
  @IsOptional() @IsString() isbn?: string;
  @IsOptional() @IsString() issn?: string;
  @IsOptional() @IsString() arxivId?: string;
  @IsOptional() @IsString() pmid?: string;
  @IsOptional() @IsString() patentNumber?: string;
  @IsOptional() @IsString() handle?: string;
  @IsOptional() @IsString() openalexId?: string;
}

/**
 * Base fields are validated here. Type-specific fields (journalName, degree, patentOffice...)
 * are passed through and validated/required by the matching Mongoose discriminator.
 */
export class CreatePublicationDto {
  @IsEnum(PublicationType)
  type!: PublicationType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  abstract?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PublicationAuthorDto)
  authors!: PublicationAuthorDto[];

  @IsInt()
  @Min(1800)
  @Max(new Date().getFullYear() + 1)
  year!: number;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @IsOptional()
  @Matches(/^[a-z]{2}$/i, { message: 'language must be an ISO 639-1 code, e.g. "en"' })
  language?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  fields?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PublicationIdentifiersDto)
  identifiers?: PublicationIdentifiersDto;

  @IsOptional()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsEnum(PublicationVisibility)
  visibility?: PublicationVisibility;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  license?: string;
}
