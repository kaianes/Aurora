import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

// POST /ops/creators/unclaimed (US-23.1, section 4.1 of the E8
// architecture doc). Only display_name and source are required; every
// other field is optional and stored exactly as given, or left null
// (scenario 2) -- never estimated or inferred.
export class CreateUnclaimedProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  display_name: string;

  @IsString()
  @MinLength(1)
  source: string;

  @IsOptional()
  @IsIn(['instagram', 'tiktok', 'youtube'])
  platform?: string;

  @IsOptional()
  @IsString()
  observed_handle?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  observed_follower_count?: number;

  @IsOptional()
  @IsString()
  observed_niche?: string;
}
