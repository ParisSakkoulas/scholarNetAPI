import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreatePublicationDto } from './create-publication.dto';

/** Every field is optional; `type` is immutable and authors are managed via /publications/:id/authors. */
export class UpdatePublicationDto extends PartialType(OmitType(CreatePublicationDto, ['type', 'authors'] as const)) {}
