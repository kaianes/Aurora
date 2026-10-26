import { IsIn, IsObject } from 'class-validator';

// definition's internal shape is validated in the service layer per rule_type
// (section 2.3 of the E4 architecture doc), not here -- this keeps the 422
// error codes (RULE_TOPIC_INVALID / RULE_PATTERN_INVALID /
// RULE_COMPETITOR_UNRESOLVED) specific to what actually failed.
export class CreateRuleDto {
  @IsIn(['prohibited_topic', 'restricted_language', 'competitor_mention'])
  rule_type: 'prohibited_topic' | 'restricted_language' | 'competitor_mention';

  @IsObject()
  definition: Record<string, any>;
}
