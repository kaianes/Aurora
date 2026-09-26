import { IsUUID } from 'class-validator';

export class GrantOperatorDto {
  @IsUUID('4', { message: 'ID de usuario invalido.' })
  user_id: string;
}
