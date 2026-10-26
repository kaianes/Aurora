import { IsString, MinLength } from 'class-validator';

// POST /campaigns/:id/briefing/qa/:threadId/messages (US-31 scenario 1, brand side).
export class AnswerQuestionDto {
  @IsString()
  @MinLength(1)
  body: string;
}
