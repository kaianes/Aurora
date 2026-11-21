import { IsString, MaxLength, MinLength } from 'class-validator';

// POST /creator-portal/briefings/:briefingId/qa/:threadId/messages/ask
// Request body for the AI-streamed Q&A endpoint (US-10.1, section 4.2 of the
// E10 architecture doc).
export class AskQuestionAiDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}
