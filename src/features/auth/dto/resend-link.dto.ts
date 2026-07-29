import { IsEmail } from "class-validator";

export class ResentVerificationLinkDto {
    @IsEmail()
    email: string;
}

