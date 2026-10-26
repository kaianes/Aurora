import { Type } from 'class-transformer';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CreateRuleDto } from './create-rule.dto';

class BulkUpdateItem {
  @IsUUID()
  id: string;

  @IsObject()
  definition: Record<string, any>;
}

// Transactional, all-or-nothing (US-15 scenario 3): no row in the batch is
// written or deleted unless every create/update item validates.
export class BulkRulesDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRuleDto)
  create?: CreateRuleDto[];

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

export { BulkUpdateItem };
