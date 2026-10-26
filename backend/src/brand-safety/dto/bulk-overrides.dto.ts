import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { CreateOverrideDto } from './create-override.dto';
import { BulkUpdateItem } from './bulk-rules.dto';

// Same all-or-nothing transactional semantics as BulkRulesDto, scoped to one
// campaign's override ruleset (section 3.2 of the E4 architecture doc).
export class BulkOverridesDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOverrideDto)
  create?: CreateOverrideDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateItem)
  update?: BulkUpdateItem[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  delete?: string[];
}
