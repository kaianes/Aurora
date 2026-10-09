import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsIn,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Formato de email invalido.' })
  email: string;

  @IsString()
  @MinLength(10, { message: 'A senha deve ter no minimo 10 caracteres.' })
  @Matches(/(?=.*[a-z])/, {
    message: 'A senha deve conter pelo menos uma letra minuscula.',
  })
  @Matches(/(?=.*[A-Z])/, {
    message: 'A senha deve conter pelo menos uma letra maiuscula.',
  })
  @Matches(/(?=.*\d)/, {
    message: 'A senha deve conter pelo menos um digito.',
  })
  @Matches(/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message: 'A senha deve conter pelo menos um caractere especial.',
  })
  password: string;

  @IsString()
  @MinLength(2, { message: 'O nome deve ter no minimo 2 caracteres.' })
  @MaxLength(100, { message: 'O nome deve ter no maximo 100 caracteres.' })
  name: string;

  @IsString()
  @MinLength(2, { message: 'O nome do workspace deve ter no minimo 2 caracteres.' })
  @MaxLength(100, { message: 'O nome do workspace deve ter no maximo 100 caracteres.' })
  workspace_name: string;

  @IsString()
  @IsIn(['brand', 'agency'], { message: 'O tipo de workspace deve ser "brand" ou "agency".' })
  workspace_type: string;
}
