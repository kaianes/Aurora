import { IsIn, IsOptional, IsString } from 'class-validator';

export class DecideReviewDto {
  @IsIn(['approved', 'rejected', 'revision_requested'])
  decision: 'approved' | 'rejected' | 'revision_requested';

  // Required when decision != 'approved' (section 3.4 of the E4
  // architecture doc). Enforced in the service layer as 422 REASON_REQUIRED
  // rather than here, since the requirement is conditional and the doc
  // specifies a dedicated error code for this exact failure.
  @IsOptional()
  @IsString()
  reason?: string;
}
