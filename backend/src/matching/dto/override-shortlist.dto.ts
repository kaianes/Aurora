import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';

class AddCreatorItem {
  @IsUUID()
  creator_id: string;
}

export class OverrideShortlistDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  remove_entry_ids?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddCreatorItem)
  add_creators?: AddCreatorItem[];
}
