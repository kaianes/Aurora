import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ADR-0048, section 2.3 of the E7 architecture document: sized to exactly
// the two visual properties a rendered client report needs. custom_domain
// is E9's own addition (US-44, ADR-0061) -- format validation (hostname
// syntax, 422 INVALID_DOMAIN_FORMAT) happens in the service layer, not here,
// so the specific error code the architecture doc names is preserved
// rather than collapsed into ValidationPipe's generic 400.
export class ConfigureBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logo_url?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_RE, { message: 'A cor primaria deve estar no formato hexadecimal (#RRGGBB).' })
  primary_color_hex?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_RE, { message: 'A cor secundaria deve estar no formato hexadecimal (#RRGGBB).' })
  secondary_color_hex?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  custom_domain?: string;
}
