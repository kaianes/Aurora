import { IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class CreateExclusionDto {
  @IsIn(['brand', 'campaign'])
  scope: 'brand' | 'campaign';

  @ValidateIf((dto) => dto.scope === 'campaign')
  @IsUUID()
  campaign_id?: string;

  @IsIn(['creator', 'competitor_brand'])
  exclusion_type: 'creator' | 'competitor_brand';

  @ValidateIf((dto) => dto.exclusion_type === 'creator')
  @IsUUID()
  creator_id?: string;

  @ValidateIf((dto) => dto.exclusion_type === 'competitor_brand')
  @IsString()
  competitor_name?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
