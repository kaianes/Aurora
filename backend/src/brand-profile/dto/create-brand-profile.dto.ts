import {
  IsString,
  IsOptional,
  IsArray,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateBrandProfileDto {
  @IsString()
  @MinLength(1, { message: 'O nome e obrigatorio.' })
  @MaxLength(200, { message: 'O nome deve ter no maximo 200 caracteres.' })
  name: string;

  @IsOptional()
  @IsString()
  tone_of_voice?: string;

  @IsOptional()
  @IsString()
  content_guidelines?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prohibited_topics?: string[];
}
