import { IsString, IsOptional, IsMongoId } from 'class-validator';

export class PinnedItemDto {
  @IsString()
  kind!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsMongoId()
  linkedItemId?: string;
}
