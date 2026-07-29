import { IsNotEmpty, IsString } from "class-validator";


export class UserLoginDto {

    @IsString()
    @IsNotEmpty()
    identifier: string;

    @IsString()
    @IsNotEmpty()
    password: string;

}