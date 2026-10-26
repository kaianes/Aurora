import { IsString, IsUUID, MinLength } from 'class-validator';

// POST /creator-portal/briefing/qa (US-31 scenario 1).
export class AskQuestionDto {
  @IsUUID()
  campaign_id: string;

  @IsString()
  @MinLength(1)
  question: string;
}
