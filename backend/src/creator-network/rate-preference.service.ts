import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatorRatePreference } from '../database/entities';
import { SetRatePreferenceDto } from './dto';
import { RATE_PREFERENCE_MAX_AMOUNT } from './creator-network.config';

// US-27 / ADR-0058 (section 7 of the E8 architecture doc). Current-value
// table only -- the non-retroactivity guarantee rides entirely on E3's
// existing prevent_opportunity_payout_mutation trigger, not on anything
// this service does.
@Injectable()
export class RatePreferenceService {
  constructor(
    @InjectRepository(CreatorRatePreference)
    private ratePreferenceRepo: Repository<CreatorRatePreference>,
  ) {}

  async setRate(creatorId: string, deliverableFormat: string, dto: SetRatePreferenceDto) {
    const amount = Number(dto.rate_amount);

    // US-27 scenario 3: rejected with a clear reason, never clamped,
    // rounded, or otherwise silently substituted.
    if (!Number.isFinite(amount) || amount <= 0 || amount > RATE_PREFERENCE_MAX_AMOUNT) {
      throw new UnprocessableEntityException({
        error: {
          code: 'INVALID_RATE',
          message: `O valor deve ser maior que zero e no maximo ${RATE_PREFERENCE_MAX_AMOUNT}.`,
          details: { min: 0, max: RATE_PREFERENCE_MAX_AMOUNT },
        },
      });
    }

    let preference = await this.ratePreferenceRepo.findOne({
      where: { creatorId, deliverableFormat },
    });

    if (!preference) {
      preference = this.ratePreferenceRepo.create({ creatorId, deliverableFormat });
    }
    preference.rateAmount = dto.rate_amount;
    preference.currency = dto.currency ?? 'BRL';
    await this.ratePreferenceRepo.save(preference);

    return {
      deliverable_format: preference.deliverableFormat,
      rate_amount: preference.rateAmount,
      currency: preference.currency,
      updated_at: preference.updatedAt.toISOString(),
      applies_to: 'future_opportunities_only',
    };
  }

  async listRates(creatorId: string) {
    const preferences = await this.ratePreferenceRepo.find({ where: { creatorId } });
    return {
      data: preferences.map((p) => ({
        deliverable_format: p.deliverableFormat,
        rate_amount: p.rateAmount,
        currency: p.currency,
        updated_at: p.updatedAt.toISOString(),
      })),
    };
  }
}
