import { IsObject } from 'class-validator';

// rule_type and action are immutable after creation (section 3.2 of the E4
// architecture doc) -- only definition can be patched.
export class UpdateRuleDto {
  @IsObject()
  definition: Record<string, any>;
}
