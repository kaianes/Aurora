import { IsString, MinLength } from 'class-validator';

// POST /ops/payout-obligations/:id/mark-failed (section 4.5 of the E6
// architecture doc).
export class MarkFailedDto {
  @IsString()
  @MinLength(1)
  reason: string;
}
