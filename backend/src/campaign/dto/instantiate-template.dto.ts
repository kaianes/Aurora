import { IsString, IsNumberString, IsDateString, MinLength, MaxLength } from 'class-validator';

export class InstantiateTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsNumberString({}, { message: 'O orcamento deve ser um valor numerico.' })
  budget_amount: string;

  @IsDateString()
  timeline_start: string;
}
