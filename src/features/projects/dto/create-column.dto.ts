import { IsString, MaxLength, IsOptional, IsNumber } from 'class-validator';

export class CreateColumnDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsNumber()
  position?: number;

  @IsOptional()
  @IsNumber()
  wipLimit?: number;
}
