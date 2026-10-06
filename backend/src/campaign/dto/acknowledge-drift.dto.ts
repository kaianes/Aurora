import { IsArray, IsOptional, IsObject, IsString } from 'class-validator';

export class AcknowledgeDriftDto {
  @IsArray()
  @IsString({ each: true })
  acknowledged_fields: string[];

  @IsOptional()
  @IsObject()
  overrides?: Record<string, any>;
}
