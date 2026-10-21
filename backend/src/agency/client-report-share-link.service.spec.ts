import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientReportShareLinkService } from './client-report-share-link.service';

const mockRepo = () => ({
  findOne: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) => Promise.resolve({ id: 'link-1', createdAt: new Date(), ...entity })),
});

function mockQueryRunner() {
  const manager = { findOne: vi.fn() };
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    startTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(undefined),
    manager,
  };
}

// US-44 / FR-57, section 2.4/2.8/5.5 of the E9 architecture doc (ADR-0061).
describe('ClientReportShareLinkService - US-44', () => {
  let service: ClientReportShareLinkService;
  let shareLinkRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let clientReportService: { getReport: ReturnType<typeof vi.fn>; getReportForSharing: ReturnType<typeof vi.fn> };
  let brandingService: { getBrandingProfile: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let dataSource: { createQueryRunner: ReturnType<typeof vi.fn> };
  let queryRunner: ReturnType<typeof mockQueryRunner>;

  const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(() => {
    shareLinkRepo = mockRepo();
    accountRepo = mockRepo();
    clientReportService = { getReport: vi.fn(), getReportForSharing: vi.fn() };
    brandingService = { getBrandingProfile: vi.fn().mockResolvedValue(null) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    configService = { get: vi.fn().mockReturnValue('https://app.aurora.com.br') };
    queryRunner = mockQueryRunner();
    dataSource = { createQueryRunner: vi.fn(() => queryRunner) };

    service = new ClientReportShareLinkService(
      shareLinkRepo as any,
      accountRepo as any,
      clientReportService as any,
      brandingService as any,
      auditService as any,
      configService as any,
      dataSource as any,
    );
  });

  describe('mint', () => {
    it('mints a link for a ready report, with share_url and display_url identical when no custom domain is configured', async () => {
      clientReportService.getReport.mockResolvedValue({ id: 'rpt-1', status: 'ready' });
      accountRepo.findOne.mockResolvedValue({ id: 'client-1', workspaceId: 'ws-1' });
      brandingService.getBrandingProfile.mockResolvedValue(null);

      const result = await service.mint('client-1', 'rpt-1', actor);

      expect(result.token).toBeTruthy();
      expect(result.share_url).toBe(`https://app.aurora.com.br/public/client-reports/${result.token}`);
      expect(result.display_url).toBe(result.share_url);
      expect(shareLinkRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'client_report_share_link.created',
          targetAccountId: 'client-1',
        }),
      );
    });

    // display_url is computed only, for Renata's own reference -- never
    // actually routed (ADR-0061, section 5.3/5.5).
    it('computes display_url under the configured custom domain without changing share_url', async () => {
      clientReportService.getReport.mockResolvedValue({ id: 'rpt-1', status: 'ready' });
      accountRepo.findOne.mockResolvedValue({ id: 'client-1', workspaceId: 'ws-1' });
      brandingService.getBrandingProfile.mockResolvedValue({
        customDomain: 'relatorios.agenciacriativa.com.br',
      });

      const result = await service.mint('client-1', 'rpt-1', actor);

      expect(result.share_url).toBe(`https://app.aurora.com.br/public/client-reports/${result.token}`);
      expect(result.display_url).toBe(
        `https://relatorios.agenciacriativa.com.br/public/client-reports/${result.token}`,
      );
    });

    it('refuses with 409 REPORT_NOT_READY when the report is still pending', async () => {
      clientReportService.getReport.mockResolvedValue({ id: 'rpt-1', status: 'pending' });

      await expect(service.mint('client-1', 'rpt-1', actor)).rejects.toThrow(ConflictException);
      expect(shareLinkRepo.save).not.toHaveBeenCalled();
    });

    it('propagates REPORT_NOT_FOUND unchanged when the report does not resolve under this account', async () => {
      clientReportService.getReport.mockRejectedValue(
        new NotFoundException({
          error: { code: 'REPORT_NOT_FOUND', message: 'Relatorio nao encontrado.', details: {} },
        }),
      );

      await expect(service.mint('client-1', 'rpt-ghost', actor)).rejects.toMatchObject({
        response: { error: { code: 'REPORT_NOT_FOUND' } },
      });
    });
  });

  describe('revoke', () => {
    it('sets revoked_at and logs the audit event', async () => {
      const link = { id: 'link-1', accountId: 'client-1', clientPerformanceReportId: 'rpt-1', revokedAt: null };
      shareLinkRepo.findOne.mockResolvedValue(link);

      await service.revoke('client-1', 'rpt-1', 'link-1', actor);

      expect(shareLinkRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'link-1', revokedAt: expect.any(Date) }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'client_report_share_link.revoked', targetAccountId: 'client-1' }),
      );
    });

    it('returns 404 when the link does not exist under this account/report', async () => {
      shareLinkRepo.findOne.mockResolvedValue(null);

      await expect(service.revoke('client-1', 'rpt-1', 'link-ghost', actor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicView (section 2.8, the public token-gated read)', () => {
    it('sets app.public_share_link_read and returns the report and branding for a valid, unexpired, unrevoked link', async () => {
      queryRunner.manager.findOne.mockResolvedValue({
        id: 'link-1',
        token: 'tok-1',
        clientPerformanceReportId: 'rpt-1',
        accountId: 'client-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      clientReportService.getReportForSharing.mockResolvedValue({
        campaign_count: 5,
        total_spend: '180000.00',
      });
      accountRepo.findOne.mockResolvedValue({
        id: 'client-1',
        workspace: { name: 'Agencia Criativa' },
      });
      brandingService.getBrandingProfile.mockResolvedValue({
        logoUrl: 'https://cdn.example.com/logo.png',
        primaryColorHex: '#1A2B3C',
        secondaryColorHex: null,
      });

      const result = await service.getPublicView('tok-1');

      expect(queryRunner.query).toHaveBeenCalledWith(`SET LOCAL app.public_share_link_read = 'true'`);
      expect(result.agency_name).toBe('Agencia Criativa');
      expect(result.branding.applied).toBe(true);
      expect(result.branding.logo_url).toBe('https://cdn.example.com/logo.png');
      expect(result.report).toEqual({ campaign_count: 5, total_spend: '180000.00' });
      expect(queryRunner.release).toHaveBeenCalled();
    });

    // US-44 scenario 3: no profile, or every visual field null, falls back
    // to the neutral presentation -- branding.applied is false, never
    // Aurora's own branding.
    it('reports branding.applied = false when no branding profile exists for the workspace', async () => {
      queryRunner.manager.findOne.mockResolvedValue({
        id: 'link-1',
        token: 'tok-1',
        clientPerformanceReportId: 'rpt-1',
        accountId: 'client-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      clientReportService.getReportForSharing.mockResolvedValue({ campaign_count: 0 });
      accountRepo.findOne.mockResolvedValue({ id: 'client-1', workspace: { name: 'Agencia Criativa' } });
      brandingService.getBrandingProfile.mockResolvedValue(null);

      const result = await service.getPublicView('tok-1');

      expect(result.branding).toEqual({
        logo_url: null,
        primary_color_hex: null,
        secondary_color_hex: null,
        applied: false,
      });
    });

    // One code -- LINK_NOT_AVAILABLE -- for "not found", "revoked", and
    // "expired", the same "do not confirm which case applies" discipline
    // used everywhere else in the platform for a resource a caller may not
    // be entitled to learn more about.
    it('returns 404 LINK_NOT_AVAILABLE when the token does not match any link', async () => {
      queryRunner.manager.findOne.mockResolvedValue(null);

      await expect(service.getPublicView('tok-ghost')).rejects.toMatchObject({
        response: { error: { code: 'LINK_NOT_AVAILABLE' } },
      });
    });

    it('returns 404 LINK_NOT_AVAILABLE when the link has been revoked', async () => {
      queryRunner.manager.findOne.mockResolvedValue({
        id: 'link-1',
        token: 'tok-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await expect(service.getPublicView('tok-1')).rejects.toMatchObject({
        response: { error: { code: 'LINK_NOT_AVAILABLE' } },
      });
    });

    it('returns 404 LINK_NOT_AVAILABLE when the link has expired', async () => {
      queryRunner.manager.findOne.mockResolvedValue({
        id: 'link-1',
        token: 'tok-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.getPublicView('tok-1')).rejects.toMatchObject({
        response: { error: { code: 'LINK_NOT_AVAILABLE' } },
      });
    });
  });
});
