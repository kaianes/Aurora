import { IsIn } from 'class-validator';

export class ResolveShortfallDto {
  @IsIn(['partial_refund', 'revised_guarantee'])
  resolution_type: 'partial_refund' | 'revised_guarantee';
}
