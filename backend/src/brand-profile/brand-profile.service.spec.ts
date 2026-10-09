import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrandProfileService } from './brand-profile.service';
import { UnprocessableEntityException } from '@nestjs/common';
import { BrandProfileStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  create: vi.fn((data: any) => ({
    ...data,
    id: 'profile-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    computeStatus() {
      const allFilled =
        this.name && this.logoUrl && this.toneOfVoice && this.contentGuidelines &&
        this.prohibitedTopics && this.prohibitedTopics.length > 0;
      return allFilled ? BrandProfileStatus.COMPLETE : BrandProfileStatus.DRAFT;
    },
  })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('BrandProfileService - US-03 Brand Profile Registration', () => {
  let service: BrandProfileService;
  let brandProfileRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    brandProfileRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const configService = { get: vi.fn().mockReturnValue('https://assets.aurora.com.br') };

    service = new BrandProfileService(
      brandProfileRepo as any,
      auditService as any,
      configService as any,
    );
  });

  // US-03 Scenario 1 - Normal: complete profile sets status to "complete"
  it('should set status to complete when all fields are provided', async () => {
    brandProfileRepo.findOne.mockResolvedValue(null); // no existing profile
    brandProfileRepo.create.mockImplementation((data: any) => {
      const profile = {
        ...data,
        id: 'profile-id',
        logoUrl: 'some-logo.png', // assume logo uploaded separately
        createdAt: new Date(),
        updatedAt: new Date(),
        status: BrandProfileStatus.DRAFT,
        computeStatus() {
          const allFilled =
            this.name && this.logoUrl && this.toneOfVoice && this.contentGuidelines &&
            this.prohibitedTopics && this.prohibitedTopics.length > 0;
          return allFilled ? BrandProfileStatus.COMPLETE : BrandProfileStatus.DRAFT;
        },
      };
      return profile;
    });

    const result = await service.create(
      'account-1',
      {
        name: 'My Brand',
        tone_of_voice: 'Friendly and professional',
        content_guidelines: 'Always use brand colors',
        prohibited_topics: ['politics', 'religion'],
      },
      'user-1',
      '127.0.0.1',
      'test-agent',
    );

    expect(result.status).toBe(BrandProfileStatus.COMPLETE);
  });

  // US-03 Scenario 2 - Hard: partial profile saved as draft
  it('should set status to draft when some fields are missing', async () => {
    brandProfileRepo.findOne.mockResolvedValue(null);

    const result = await service.create(
      'account-1',
      {
        name: 'My Brand',
        // no tone_of_voice, no content_guidelines, no prohibited_topics
      },
      'user-1',
      '127.0.0.1',
      'test-agent',
    );

    expect(result.status).toBe(BrandProfileStatus.DRAFT);
  });

  // US-03 Scenario 3 - Failure: oversized logo upload rejected
  it('should reject logo file exceeding 5 MB', async () => {
    brandProfileRepo.findOne.mockResolvedValue({
      id: 'profile-id',
      accountId: 'account-1',
    });

    const oversizedFile = {
      fieldname: 'file',
      originalname: 'huge-logo.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 6 * 1024 * 1024, // 6 MB
      buffer: Buffer.alloc(0),
    };

    await expect(
      service.uploadLogo('profile-id', 'account-1', oversizedFile, 'user-1', '127.0.0.1', 'test-agent'),
    ).rejects.toThrow(UnprocessableEntityException);

    try {
      await service.uploadLogo('profile-id', 'account-1', oversizedFile, 'user-1', '127.0.0.1', 'test-agent');
    } catch (e: any) {
      expect(e.getResponse().error.code).toBe('FILE_TOO_LARGE');
    }
  });

  // US-03 Scenario 3 - Failure: wrong format logo upload rejected
  it('should reject logo file with unsupported format', async () => {
    brandProfileRepo.findOne.mockResolvedValue({
      id: 'profile-id',
      accountId: 'account-1',
    });

    const wrongFormatFile = {
      fieldname: 'file',
      originalname: 'doc.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.alloc(0),
    };

    await expect(
      service.uploadLogo('profile-id', 'account-1', wrongFormatFile, 'user-1', '127.0.0.1', 'test-agent'),
    ).rejects.toThrow(UnprocessableEntityException);

    try {
      await service.uploadLogo('profile-id', 'account-1', wrongFormatFile, 'user-1', '127.0.0.1', 'test-agent');
    } catch (e: any) {
      expect(e.getResponse().error.code).toBe('UNSUPPORTED_FORMAT');
      expect(e.getResponse().error.details.allowed_formats).toBeDefined();
    }
  });
});
