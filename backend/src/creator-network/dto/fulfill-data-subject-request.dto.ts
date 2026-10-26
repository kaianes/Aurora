import { IsIn, IsOptional, IsString } from 'class-validator';

// PATCH /ops/creators/:id/data-subject-requests/:requestId (ADR-0056,
// section 8.2 of the E8 architecture doc). For access/portability,
// export_document_url is the generated export; for deletion/correction,
// fulfillment is performed out-of-band by the operator before marking the
// row fulfilled.
export class FulfillDataSubjectRequestDto {
  @IsIn(['fulfilled'])
  status: 'fulfilled';

  @IsOptional()
  @IsString()
  export_document_url?: string;
}
