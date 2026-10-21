import { IsIn } from 'class-validator';

// POST /ops/creators/:id/data-subject-requests (ADR-0056, section 8.1 of
// the E8 architecture doc).
export class CreateDataSubjectRequestDto {
  @IsIn(['access', 'correction', 'deletion', 'portability'])
  request_type: 'access' | 'correction' | 'deletion' | 'portability';
}
