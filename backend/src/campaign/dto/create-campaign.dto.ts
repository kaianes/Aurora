import {
  IsString,
  IsOptional,
  IsArray,
  IsNumberString,
  IsDateString,
  MinLength,
  MaxLength,
  IsObject,
} from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @MinLength(2, { message: 'O nome deve ter no minimo 2 caracteres.' })
  @MaxLength(150, { message: 'O nome deve ter no maximo 150 caracteres.' })
  name: string;

  @IsOptional()
  @IsNumberString({}, { message: 'O orcamento deve ser um valor numerico.' })
  budget_amount?: string;

  @IsOptional()
  @IsString()
  budget_currency?: string;

  @IsOptional()
  @IsObject()
  audience_targeting?: Record<string, any>;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deliverable_formats?: string[];

  @IsOptional()
  @IsDateString()
  timeline_start?: string;

  @IsOptional()
  @IsDateString()
  timeline_end?: string;
}
