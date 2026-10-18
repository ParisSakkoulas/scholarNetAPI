import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreatePublicationDto } from './create-publication.dto';

/** Every field is optional; `type` is immutable after creation. */
export class UpdatePublicationDto extends PartialType(OmitType(CreatePublicationDto, ['type'] as const)) {}
