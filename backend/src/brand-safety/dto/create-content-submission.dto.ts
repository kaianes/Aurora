import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateContentSubmissionDto {
  @IsUUID()
  campaign_id: string;

  @IsOptional()
  @IsUUID()
  opportunity_id?: string;

  // Required-ness ("missing or empty") is enforced in the service layer as
  // 422 (section 3.3 of the E4 architecture doc), not here, so a missing
  // caption_text gets the documented error shape rather than Nest's default
  // 400 validation-pipe response.
  @IsOptional()
  @IsString()
  caption_text?: string;

  @IsOptional()
  @IsString()
  on_screen_text?: string;

  @IsOptional()
  @IsString()
  audio_transcript?: string;

  @IsOptional()
  @IsString()
  media_asset_url?: string;
}
