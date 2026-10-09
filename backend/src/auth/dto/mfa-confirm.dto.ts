import { IsString } from 'class-validator';

export class MfaConfirmDto {
  @IsString()
  code: string;
}
