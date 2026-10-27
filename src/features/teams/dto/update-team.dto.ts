import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateTeamDto } from './create-team.dto';

/** The slug is a stable identifier, so it is not editable. */
export class UpdateTeamDto extends PartialType(OmitType(CreateTeamDto, ['slug', 'description'] as const)) {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
