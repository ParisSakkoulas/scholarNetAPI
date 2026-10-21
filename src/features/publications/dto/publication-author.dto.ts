import { PartialType, PickType } from '@nestjs/mapped-types';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsMongoId } from 'class-validator';
import { PublicationAuthorDto } from './create-publication.dto';

/** Adds one author. Give `user` for a scholarNet member, or just `name` for an outside co-author. */
export class AddAuthorDto extends PublicationAuthorDto {}

/** The linked `user` cannot change: remove the entry and add a new one instead. */
export class UpdateAuthorDto extends PartialType(
  PickType(PublicationAuthorDto, ['name', 'affiliation', 'orcid', 'isCorresponding'] as const),
) {}

export class ReorderAuthorsDto {
  /** Every author `_id`, in the new order. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  order!: string[];
}
