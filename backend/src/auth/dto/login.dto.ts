import { IsEmail, IsString, IsOptional } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Formato de email invalido.' })
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  mfa_code?: string;
}
