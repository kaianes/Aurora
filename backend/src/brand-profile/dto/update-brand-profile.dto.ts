import { IsString, IsOptional, IsArray } from 'class-validator';

export class UpdateBrandProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  tone_of_voice?: string | null;

  @IsOptional()
  @IsString()
  content_guidelines?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prohibited_topics?: string[] | null;
}
