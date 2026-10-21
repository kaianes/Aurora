import { IsOptional, IsString } from 'class-validator';

// POST /ops/payout-obligations/:id/mark-settled (section 4.5 of the E6
// architecture doc). provider_reference is free text, the operator's own
// record of what they verified -- no format is enforced.
export class MarkSettledDto {
  @IsOptional()
  @IsString()
  provider_reference?: string;
}
