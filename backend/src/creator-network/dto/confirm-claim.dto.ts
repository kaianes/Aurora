import { IsBoolean, IsEmail, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

// POST /creator-portal/invitations/:token/confirm (US-23.2, section 4.4 of
// the E8 architecture doc). corrections' keys fully replace the imported
// value for that field -- unspecified fields keep the import's existing
// values, never merged field-by-field (scenario 2).
export class ConfirmClaimDto {
  @IsEmail({}, { message: 'Formato de email invalido.' })
  email: string;

  @IsString()
  @MinLength(10, { message: 'A senha deve ter no minimo 10 caracteres.' })
  password: string;

  @IsOptional()
  @IsObject()
  corrections?: {
    display_name?: string;
    content_niche?: string;
  };

  @IsBoolean()
  accepted_terms: boolean;

  @IsString()
  terms_version: string;
}
