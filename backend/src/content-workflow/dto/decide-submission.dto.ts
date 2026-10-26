import { IsIn, IsOptional, IsString } from 'class-validator';

// POST /content-submissions/:id/decide (US-19). reason is required when
// decision != 'approved', enforced in the service layer as 422
// REASON_REQUIRED (section 4.5 of the E5 architecture doc), not here.
export class DecideSubmissionDto {
  @IsIn(['approved', 'rejected', 'revision_requested'])
  decision: 'approved' | 'rejected' | 'revision_requested';

  @IsOptional()
  @IsString()
  reason?: string;
}
