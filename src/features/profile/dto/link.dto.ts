import { IsString } from 'class-validator';

export class LinkDto {
  @IsString()
  type!: string;

  @IsString()
  url!: string;
}
