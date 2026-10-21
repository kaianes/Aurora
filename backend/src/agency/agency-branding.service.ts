import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AgencyBrandingProfile } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { ConfigureBrandingDto } from './dto/configure-branding.dto';

// Lowercase, RFC 1123-compatible hostname syntax only -- no DNS lookup, no
// ownership proof (US-44, ADR-0061). Rejects a leading/trailing hyphen on
// any label and requires at least one dot (a bare, single-label host is
// never a usable public hostname for this purpose).
const HOSTNAME_RE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

// ADR-0048, section 2.3 of the E7 architecture document. Lives in the
// agency module (owned long-term by E9). getBrandingProfile is the one
// narrow read method analytics's report renderer calls in-process -- the
// same exported-service-for-in-process-reuse pattern ADR-0032/ADR-0036
// already established.
@Injectable()
export class AgencyBrandingService {
  constructor(
    @InjectRepository(AgencyBrandingProfile)
    private brandingRepo: Repository<AgencyBrandingProfile>,
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    private auditService: AuditService,
  ) {}

  // A row with all three visual fields null is the default, "not yet
  // configured" state (section 2.3) -- callers treat a missing row and an
  // all-null row identically.
  async getBrandingProfile(workspaceId: string): Promise<AgencyBrandingProfile | null> {
    return this.brandingRepo.findOne({ where: { workspaceId } });
  }

  async configureBranding(
    currentAccountId: string,
    dto: ConfigureBrandingDto,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const account = await this.accountRepo.findOne({ where: { id: currentAccountId } });
    if (!account) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Conta nao encontrada.', details: {} },
      });
    }

    let profile = await this.brandingRepo.findOne({ where: { workspaceId: account.workspaceId } });
    if (!profile) {
      profile = this.brandingRepo.create({ workspaceId: account.workspaceId });
    }

    if (dto.logo_url !== undefined) profile.logoUrl = dto.logo_url;
    if (dto.primary_color_hex !== undefined) profile.primaryColorHex = dto.primary_color_hex;
    if (dto.secondary_color_hex !== undefined) profile.secondaryColorHex = dto.secondary_color_hex;

    // US-44 / ADR-0061, section 2.3/5.3: setting a non-null custom_domain
    // always sets domain_status = 'pending_activation'. domain_status never
    // reaches any other value in this pilot (chk_domain_status_values).
    let domainConfigured = false;
    if (dto.custom_domain !== undefined) {
      if (!HOSTNAME_RE.test(dto.custom_domain)) {
        throw new UnprocessableEntityException({
          error: {
            code: 'INVALID_DOMAIN_FORMAT',
            message: 'O dominio informado nao e valido.',
            details: {},
          },
        });
      }
      profile.customDomain = dto.custom_domain;
      profile.domainStatus = 'pending_activation';
      domainConfigured = true;
    }

    profile.updatedByUserId = actorUserId;

    const saved = await this.brandingRepo.save(profile);

    await this.auditService.log({
      actorUserId,
      targetAccountId: currentAccountId,
      action: 'agency_branding_profile.configured',
      metadata: { workspace_id: account.workspaceId },
      ipAddress,
      userAgent,
    });

    if (domainConfigured) {
      await this.auditService.log({
        actorUserId,
        targetAccountId: currentAccountId,
        action: 'agency_branding_profile.domain_configured',
        metadata: { workspace_id: account.workspaceId, custom_domain: saved.customDomain },
        ipAddress,
        userAgent,
      });
    }

    return this.format(saved);
  }

  async getBrandingForAccount(currentAccountId: string) {
    const account = await this.accountRepo.findOne({ where: { id: currentAccountId } });
    if (!account) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Conta nao encontrada.', details: {} },
      });
    }
    const profile = await this.getBrandingProfile(account.workspaceId);
    return profile
      ? this.format(profile)
      : {
          logo_url: null,
          primary_color_hex: null,
          secondary_color_hex: null,
          custom_domain: null,
          domain_status: null,
        };
  }

  private format(profile: AgencyBrandingProfile) {
    return {
      logo_url: profile.logoUrl,
      primary_color_hex: profile.primaryColorHex,
      secondary_color_hex: profile.secondaryColorHex,
      custom_domain: profile.customDomain,
      domain_status: profile.domainStatus,
      updated_at: profile.updatedAt.toISOString(),
    };
  }
}
