import { IsString, MaxLength, IsOptional, IsNumber } from 'class-validator';

export class CreateBoardDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsNumber()
  position?: number;
}
