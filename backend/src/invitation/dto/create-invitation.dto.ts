import { IsEmail, IsString, IsIn } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail({}, { message: 'Formato de email invalido.' })
  email: string;

  @IsString()
  @IsIn(
    [
      'brand_manager',
      'brand_analyst',
      'agency_operator',
    ],
    {
      message:
        'Papel invalido. Valores permitidos: brand_manager, brand_analyst, agency_operator.',
    },
  )
  role: string;
}
