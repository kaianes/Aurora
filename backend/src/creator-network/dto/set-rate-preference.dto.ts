import { IsOptional, IsString } from 'class-validator';

// PUT /creator-portal/rate-preferences/:deliverableFormat (US-27, section
// 7.1 of the E8 architecture doc). rate_amount is accepted as a string, the
// same convention every other monetary field in this codebase already uses
// (numeric columns backed by string-typed DTOs/entities to avoid floating-
// point drift), and is validated as a bounded number in the service layer
// (ADR-0058) -- never clamped or rounded silently.
export class SetRatePreferenceDto {
  @IsString()
  rate_amount: string;

  @IsOptional()
  @IsString()
  currency?: string;
}
