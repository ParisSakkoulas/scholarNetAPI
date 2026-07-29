import { IsString } from 'class-validator';

export class InterestDto {
  @IsString()
  name!: string;
}
