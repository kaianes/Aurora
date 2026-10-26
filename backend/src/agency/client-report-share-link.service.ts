import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Account, ClientReportShareLink } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { AgencyBrandingService } from './agency-branding.service';
import { ClientReportService } from '../analytics/client-report.service';

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

const LINK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

// US-44 / FR-57, section 2.4/5.5 of the E9 architecture doc (ADR-0061).
// client_performance_report is read only through ClientReportService's
// exported methods (section 3.3) -- this service never queries that table
// directly.
@Injectable()
export class ClientReportShareLinkService {
  constructor(
    @InjectRepository(ClientReportShareLink)
    private shareLinkRepo: Repository<ClientReportShareLink>,
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    private clientReportService: ClientReportService,
    private brandingService: AgencyBrandingService,
    private auditService: AuditService,
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {}

  async mint(clientAccountId: string, reportId: string, actor: ActorContext) {
    // getReport throws REPORT_NOT_FOUND for both "does not exist" and
    // "belongs to a different account" -- the same one-code-for-both
    // discipline every other report lookup in this platform already uses.
    const report = await this.clientReportService.getReport(clientAccountId, reportId);
    if (report.status !== 'ready') {
      throw new ConflictException({
        error: {
          code: 'REPORT_NOT_READY',
          message: 'O relatorio ainda nao esta pronto para ser compartilhado.',
          details: { status: report.status },
        },
      });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const link = this.shareLinkRepo.create({
      clientPerformanceReportId: reportId,
      accountId: clientAccountId,
      token,
      createdByUserId: actor.userId,
      expiresAt: new Date(now.getTime() + LINK_LIFETIME_MS),
    });
    const saved = await this.shareLinkRepo.save(link);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: clientAccountId,
      action: 'client_report_share_link.created',
      metadata: { report_id: reportId, link_id: saved.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const account = await this.accountRepo.findOne({ where: { id: clientAccountId } });
    const profile = account ? await this.brandingService.getBrandingProfile(account.workspaceId) : null;

    const frontendUrl = this.configService.get('FRONTEND_URL');
    const sharePath = `/public/client-reports/${token}`;
    const shareUrl = `${frontendUrl}${sharePath}`;
    // display_url is computed, never routed (section 5.3/5.5, ADR-0061): no
    // request to the configured custom_domain is ever actually served by
    // Aurora in this pilot.
    const displayUrl = profile?.customDomain ? `https://${profile.customDomain}${sharePath}` : shareUrl;

    return {
      token,
      share_url: shareUrl,
      display_url: displayUrl,
      expires_at: saved.expiresAt.toISOString(),
    };
  }

  async revoke(clientAccountId: string, reportId: string, linkId: string, actor: ActorContext) {
    const link = await this.shareLinkRepo.findOne({
      where: { id: linkId, accountId: clientAccountId, clientPerformanceReportId: reportId },
    });
    if (!link) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Link de compartilhamento nao encontrado.', details: {} },
      });
    }

    link.revokedAt = new Date();
    await this.shareLinkRepo.save(link);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: clientAccountId,
      action: 'client_report_share_link.revoked',
      metadata: { report_id: reportId, link_id: linkId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  // GET /public/client-reports/:token (section 2.8, 5.5). No X-Account-Id,
  // no authenticated session exists for this request -- the exact-match
  // token filter below is the real restriction; app.public_share_link_read
  // only lets the matched row through client_report_share_link's RLS
  // policy, which would otherwise block it for lack of any tenant context.
  async getPublicView(token: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let link: ClientReportShareLink | null = null;
    try {
      await queryRunner.query(`SET LOCAL app.public_share_link_read = 'true'`);
      link = await queryRunner.manager.findOne(ClientReportShareLink, { where: { token } });
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // One code for "not found", "revoked", and "expired" -- the same
    // "do not confirm which case applies" discipline used everywhere else
    // in this platform for a resource a caller might not be entitled to
    // learn more about.
    if (!link || link.revokedAt || link.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({
        error: { code: 'LINK_NOT_AVAILABLE', message: 'Este link nao esta mais disponivel.', details: {} },
      });
    }

    const report = await this.clientReportService.getReportForSharing(
      link.clientPerformanceReportId,
      link.accountId,
    );

    const account = await this.accountRepo.findOne({
      where: { id: link.accountId },
      relations: { workspace: true },
    });
    const profile = account ? await this.brandingService.getBrandingProfile(account.workspaceId) : null;
    const hasVisuals = !!(profile?.logoUrl || profile?.primaryColorHex || profile?.secondaryColorHex);

    return {
      agency_name: account?.workspace?.name ?? null,
      branding: {
        logo_url: profile?.logoUrl ?? null,
        primary_color_hex: profile?.primaryColorHex ?? null,
        secondary_color_hex: profile?.secondaryColorHex ?? null,
        // Section 5.5 step 4 / US-44 scenario 3: no profile, or every
        // visual field null, renders the same neutral fallback ADR-0048
        // already established for the report itself -- never Aurora's own
        // branding.
        applied: hasVisuals,
      },
      report,
    };
  }
}
