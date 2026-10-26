import { IsIn, IsObject, IsUUID, ValidateIf } from 'class-validator';

// Rule-level supersession (ADR-0019). rule_type/definition are not required
// for a 'suppress' override -- the superseded brand rule's own rule_type is
// copied, and a suppressed rule carries no definition (section 2.6's
// chk_rule_definition_presence). For 'replace', rule_type/definition
// describe this campaign's own version of the superseded rule.
export class CreateOverrideDto {
  @IsIn(['add', 'replace', 'suppress'])
  action: 'add' | 'replace' | 'suppress';

  @ValidateIf((dto) => dto.action === 'replace' || dto.action === 'suppress')
  @IsUUID()
  supersedes_rule_id?: string;

  @ValidateIf((dto) => dto.action === 'add' || dto.action === 'replace')
  @IsIn(['prohibited_topic', 'restricted_language', 'competitor_mention'])
  rule_type?: 'prohibited_topic' | 'restricted_language' | 'competitor_mention';

  @ValidateIf((dto) => dto.action === 'add' || dto.action === 'replace')
  @IsObject()
  definition?: Record<string, any>;
}
