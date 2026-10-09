import { IsString, IsOptional, MinLength, MaxLength, IsUUID } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @MinLength(2, { message: 'O nome deve ter no minimo 2 caracteres.' })
  @MaxLength(100, { message: 'O nome deve ter no maximo 100 caracteres.' })
  name: string;

  @IsOptional()
  @IsUUID('4', { message: 'ID de conta invalido.' })
  copy_templates_from?: string;
}
