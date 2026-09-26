import { IsString, IsOptional, MinLength, Matches } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  token: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter no minimo 2 caracteres.' })
  name?: string;

  @IsOptional()
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
  password?: string;
}
