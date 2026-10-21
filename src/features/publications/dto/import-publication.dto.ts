import { IsEnum, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PublicationVisibility } from '../schemas/publication.schema';

export const IMPORT_SOURCES = ['openalex', 'dblp'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** The DOI as typed by the user; "https://doi.org/..." is accepted and normalized. */
export const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;

export class ImportPublicationDto {
  @IsString()
  doi!: string;

  /** The source the user confirmed on the preview. It is fetched again, not taken from the client. */
  @IsIn(IMPORT_SOURCES)
  source!: ImportSource;

  @IsOptional()
  @IsEnum(PublicationVisibility)
  visibility?: PublicationVisibility;
}
