import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class RequestEmailDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsEmail()
  newEmail!: string;
}
