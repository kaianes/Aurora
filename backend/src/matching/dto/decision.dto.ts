import { IsIn } from 'class-validator';

export class DecisionDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
