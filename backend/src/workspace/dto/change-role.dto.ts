import { IsString, IsIn } from 'class-validator';

export class ChangeRoleDto {
  @IsString()
  @IsIn(
    [
      'brand_owner',
      'brand_manager',
      'brand_analyst',
      'agency_admin',
      'agency_operator',
    ],
    { message: 'Papel invalido.' },
  )
  role: string;
}
