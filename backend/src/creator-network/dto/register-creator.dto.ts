import { IsBoolean, IsEmail, IsString, MaxLength, MinLength, Matches } from 'class-validator';

// POST /creator-portal/register (US-24.1, section 5.1 of the E8
// architecture doc). Same password policy as E1's brand RegisterDto,
// reused via AuthService.createUser rather than duplicated.
export class RegisterCreatorDto {
  @IsEmail({}, { message: 'Formato de email invalido.' })
  email: string;

  @IsString()
  @MinLength(10, { message: 'A senha deve ter no minimo 10 caracteres.' })
  @Matches(/(?=.*[a-z])/, { message: 'A senha deve conter pelo menos uma letra minuscula.' })
  @Matches(/(?=.*[A-Z])/, { message: 'A senha deve conter pelo menos uma letra maiuscula.' })
  @Matches(/(?=.*\d)/, { message: 'A senha deve conter pelo menos um digito.' })
  password: string;

  @IsString()
  @MinLength(2, { message: 'O nome deve ter no minimo 2 caracteres.' })
  @MaxLength(100, { message: 'O nome deve ter no maximo 100 caracteres.' })
  name: string;

  @IsBoolean()
  accepted_terms: boolean;

  @IsString()
  terms_version: string;
}
