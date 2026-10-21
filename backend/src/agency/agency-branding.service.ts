import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AgencyBrandingProfile } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { ConfigureBrandingDto } from './dto/configure-branding.dto';

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
      : { logo_url: null, primary_color_hex: null, secondary_color_hex: null };
  }

  private format(profile: AgencyBrandingProfile) {
    return {
      logo_url: profile.logoUrl,
      primary_color_hex: profile.primaryColorHex,
      secondary_color_hex: profile.secondaryColorHex,
      updated_at: profile.updatedAt.toISOString(),
    };
  }
}
