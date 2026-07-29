import { Type } from 'class-transformer';
import {
    IsArray,
    IsEnum,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

export enum ImportSource {
    DBLP = 'dblp',
    GOOGLE_SCHOLAR = 'google_scholar',
    WEB_OF_SCIENCE = 'web_of_science',
    FILE_UPLOAD = 'file_upload',
    MANUAL = 'manual',
}

export enum ImportFormat {
    BIBTEX = 'bibtex',
    XML = 'xml',
    RDF = 'rdf',
    JSON = 'json',
}

export class RawImportItemDto {
    @IsOptional()
    @IsString()
    externalId?: string;

    @IsString()
    raw: string;
}

export class BulkImportFromFileDto {
    @IsEnum(ImportFormat)
    format: ImportFormat;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RawImportItemDto)
    items: RawImportItemDto[];
}

export class BulkImportFromSourceDto {
    @IsEnum(ImportSource)
    source: ImportSource;

    @IsString()
    creatorName: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    confirmedMergeIds?: string[];
}

export class ImportCollisionDto {
    incomingTitle: string;
    existingId: string;
    existingTitle: string;
    confidence: number;
}

export class BulkImportResultDto {
    imported: number;
    skipped: number;
    collisions: ImportCollisionDto[];
    errors: string[];
}