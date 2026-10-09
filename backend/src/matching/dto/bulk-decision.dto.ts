import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';

class BulkDecisionItem {
  @IsUUID()
  entry_id: string;

  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}

export class BulkDecisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkDecisionItem)
  decisions: BulkDecisionItem[];
}
