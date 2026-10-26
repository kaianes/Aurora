import { IsString, MinLength } from 'class-validator';

// Thin authenticated HTTP wrapper for BrandSafetyGateService.recordPublication
// (section 3.6 of the E4 architecture doc), used until E5 exists to call the
// method directly.
export class RecordPublicationDto {
  @IsString()
  @MinLength(1)
  published_url: string;
}
