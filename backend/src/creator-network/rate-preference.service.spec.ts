import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { RatePreferenceService } from './rate-preference.service';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  create: vi.fn((data: any) => ({ id: 'rp-1', updatedAt: new Date(), ...data })),
  save: vi.fn((entity: any) => Promise.resolve({ ...entity, updatedAt: new Date() })),
});

describe('RatePreferenceService - US-27 / ADR-0058', () => {
  let service: RatePreferenceService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    repo = mockRepo();
    service = new RatePreferenceService(repo as any);
  });

  // Scenario 1
  it('stores and returns a rate preference, flagged as applying to future opportunities only', async () => {
    repo.findOne.mockResolvedValue(null);

    const result = await service.setRate('creator-1', 'instagram_reel', { rate_amount: '350.00' });

    expect(result.rate_amount).toBe('350.00');
    expect(result.currency).toBe('BRL');
    expect(result.applies_to).toBe('future_opportunities_only');
  });

  // Scenario 2 (the non-retroactivity promise itself lives on E3's opportunity
  // trigger -- this service's job is just to upsert the current value and say so).
  it('upserts the existing row for the same creator and format rather than creating a second one', async () => {
    const existing = {
      id: 'rp-1',
      creatorId: 'creator-1',
      deliverableFormat: 'instagram_reel',
      rateAmount: '300',
      currency: 'BRL',
      updatedAt: new Date(),
    };
    repo.findOne.mockResolvedValue(existing);

    await service.setRate('creator-1', 'instagram_reel', { rate_amount: '400.00' });

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'rp-1', rateAmount: '400.00' }));
  });

  // Scenario 3
  it.each([['0'], ['-10'], ['50001']])('rejects an invalid rate (%s) with a clear reason, never clamping it', async (value) => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.setRate('creator-1', 'instagram_reel', { rate_amount: value })).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('lists every format she has set a rate for', async () => {
    repo.find.mockResolvedValue([
      { deliverableFormat: 'instagram_reel', rateAmount: '350.00', currency: 'BRL', updatedAt: new Date() },
    ]);

    const result = await service.listRates('creator-1');
    expect(result.data).toHaveLength(1);
  });
});
