import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// PATCH /creator-portal/profile (section 5, step 3 of the E8 architecture
// doc). A straightforward field update on her own creator row, same shape
// as the claim-confirm corrections.
export class UpdateCreatorProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  content_niche?: string;
}
