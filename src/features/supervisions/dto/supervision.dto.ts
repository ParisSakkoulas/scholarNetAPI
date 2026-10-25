import {
  IsBoolean,
  IsEmail,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class InviteSupervisorDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  /** An existing platform user (found through the user search)... */
  @ValidateIf((o) => !o.email)
  @IsMongoId()
  supervisorId?: string;

  /** ...or an email address; if it is not registered yet, the invite is claimed after signup. */
  @ValidateIf((o) => !o.supervisorId)
  @IsEmail()
  email?: string;
}

export class RespondSupervisionDto {
  @IsBoolean()
  accept!: boolean;
}
