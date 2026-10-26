import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AgencyBrandingService } from './agency-branding.service';

const mockRepo = () => ({
  findOne: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) =>
    Promise.resolve({ id: entity.id || 'profile-1', updatedAt: new Date('2026-10-21T10:00:00Z'), ...entity }),
  ),
});

describe('AgencyBrandingService - ADR-0048 / US-43 branding configuration', () => {
  let service: AgencyBrandingService;
  let brandingRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    brandingRepo = mockRepo();
    accountRepo = mockRepo();
    auditService = { log: vi.fn() };

    service = new AgencyBrandingService(brandingRepo as any, accountRepo as any, auditService as any);
  });

  // ---- The "not yet configured" default state (section 2.3): a missing row
  // and an all-null row are treated identically by callers. ----
  it('getBrandingProfile returns no profile when none has ever been configured for the workspace', async () => {
    // Real TypeORM findOne resolves null for "no row"; this mock only needs
    // to prove the service passes that straight through without throwing
    // or substituting a fabricated default row.
    brandingRepo.findOne.mockResolvedValue(null);

    const result = await service.getBrandingProfile('ws-1');

    expect(result).toBeNull();
    expect(brandingRepo.findOne).toHaveBeenCalledWith({ where: { workspaceId: 'ws-1' } });
  });

  it('getBrandingForAccount returns neutral nulls, not an error, before any branding is configured', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'acct-1', workspaceId: 'ws-1' });
    brandingRepo.findOne.mockResolvedValue(undefined);

    const result = await service.getBrandingForAccount('acct-1');

    expect(result).toEqual({
      logo_url: null,
      primary_color_hex: null,
      secondary_color_hex: null,
      custom_domain: null,
      domain_status: null,
    });
  });

  it('getBrandingForAccount throws NotFoundException when the account itself does not resolve', async () => {
    accountRepo.findOne.mockResolvedValue(undefined);

    await expect(service.getBrandingForAccount('acct-missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---- Configuring branding for the first time creates a new row, scoped
  // to the agency's own workspace (never any client's). ----
  it('configureBranding creates a new profile on first configuration and logs the audit event', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'acct-agency-home', workspaceId: 'ws-1' });
    brandingRepo.findOne.mockResolvedValue(undefined);

    const result = await service.configureBranding(
      'acct-agency-home',
      { logo_url: 'https://cdn.example.com/logo.png', primary_color_hex: '#3DDC97', secondary_color_hex: '#7F77DD' },
      'user-1',
      '127.0.0.1',
      'test-agent',
    );

    expect(brandingRepo.create).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
    expect(brandingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        logoUrl: 'https://cdn.example.com/logo.png',
        primaryColorHex: '#3DDC97',
        secondaryColorHex: '#7F77DD',
        updatedByUserId: 'user-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        logo_url: 'https://cdn.example.com/logo.png',
        primary_color_hex: '#3DDC97',
        secondary_color_hex: '#7F77DD',
      }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agency_branding_profile.configured', targetAccountId: 'acct-agency-home' }),
    );
  });

  // ---- A second configuration call updates the existing row in place
  // rather than creating a duplicate, and only overwrites fields actually
  // provided in the DTO. ----
  it('configureBranding updates the existing profile rather than creating a second row', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'acct-agency-home', workspaceId: 'ws-1' });
    brandingRepo.findOne.mockResolvedValue({
      id: 'profile-1',
      workspaceId: 'ws-1',
      logoUrl: 'https://old.example.com/logo.png',
      primaryColorHex: '#111111',
      secondaryColorHex: '#222222',
    });

    await service.configureBranding(
      'acct-agency-home',
      { primary_color_hex: '#3DDC97' },
      'user-1',
      '127.0.0.1',
      'test-agent',
    );

    expect(brandingRepo.create).not.toHaveBeenCalled();
    const saved = brandingRepo.save.mock.calls[0][0];
    expect(saved.id).toBe('profile-1');
    expect(saved.primaryColorHex).toBe('#3DDC97');
    // Fields not present in this call's DTO are left untouched, not nulled out.
    expect(saved.logoUrl).toBe('https://old.example.com/logo.png');
    expect(saved.secondaryColorHex).toBe('#222222');
  });

  it('getBrandingForAccount returns the configured profile once branding has been set', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'acct-agency-home', workspaceId: 'ws-1' });
    brandingRepo.findOne.mockResolvedValue({
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColorHex: '#3DDC97',
      secondaryColorHex: '#7F77DD',
      updatedAt: new Date('2026-10-21T10:00:00Z'),
    });

    const result = await service.getBrandingForAccount('acct-agency-home');

    expect(result).toEqual(
      expect.objectContaining({
        logo_url: 'https://cdn.example.com/logo.png',
        primary_color_hex: '#3DDC97',
        secondary_color_hex: '#7F77DD',
      }),
    );
  });
});
