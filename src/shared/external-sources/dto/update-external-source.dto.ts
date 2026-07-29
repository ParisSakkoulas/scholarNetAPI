import { PartialType } from '@nestjs/mapped-types';
import { CreateExternalSourceDto } from './create-external-source.dto';

export class UpdateExternalSourceDto extends PartialType(CreateExternalSourceDto) {}
