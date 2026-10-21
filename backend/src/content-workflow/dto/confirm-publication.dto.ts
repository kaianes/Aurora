import { IsString, MinLength } from 'class-validator';

// POST /creator-portal/content-submissions/:id/confirm-publication (US-34, FR-42).
export class ConfirmPublicationDto {
  @IsString()
  @MinLength(1)
  published_url: string;
}
