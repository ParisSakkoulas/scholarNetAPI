import { IsEmail, IsJWT, IsNotEmpty, IsString } from 'class-validator';

export class RequestEmailDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsEmail()
  newEmail!: string;
}

export class ConfirmEmailChangeDto {
  @IsJWT()
  @IsNotEmpty()
  token!: string;
}
