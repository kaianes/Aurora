import { IsArray, IsISO8601, IsObject, IsOptional, IsString } from 'class-validator';
import { DeliverableSpec } from '../../database/entities';

// PUT /campaigns/:id/briefing (US-18a). Accepts any subset of fields -- a
// partial-update semantic despite the HTTP verb (section 4.2 of the E5
// architecture doc): a field left out of the request body is left untouched
// on the stored briefing, not blanked.
export class UpsertBriefingDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dos?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  donts?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reference_examples?: string[];

  // Free-form object (section 3.2): only `format` is required, and only at
  // issue time, not here.
  @IsOptional()
  @IsObject()
  deliverable_spec?: DeliverableSpec;

  @IsOptional()
  @IsISO8601()
  deadline?: string;
}
