import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ADR-0048, section 2.3 of the E7 architecture document: sized to exactly
// the two visual properties a rendered client report needs. No domain, no
// white-label configuration (E9's own scope).
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
}
