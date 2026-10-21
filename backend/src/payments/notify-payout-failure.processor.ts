import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import { PayoutObligation } from '../database/entities';
import {
  PAYOUT_NOTIFICATION_ADAPTER,
  PayoutNotificationAdapter,
} from './adapters/payout-notification.adapter';

// US-35c / FR-46 (ADR-0043). Enqueued on first detected failure, and again
// by notify-overdue-payout-failures as a crashed-enqueue safety net.
// failure_notification_sent_at is set regardless of the adapter's
// delivered outcome -- in-app visibility (US-36a) never depends on it.
@Processor('payments')
export class NotifyPayoutFailureProcessor {
  private readonly logger = new Logger(NotifyPayoutFailureProcessor.name);

  constructor(
    @InjectRepository(PayoutObligation)
    private obligationRepo: Repository<PayoutObligation>,
    @Inject(PAYOUT_NOTIFICATION_ADAPTER)
    private notificationAdapter: PayoutNotificationAdapter,
  ) {}

  @Process('notify-payout-failure')
  async handle(job: Job<{ payoutObligationId: string; reason?: string }>) {
    const { payoutObligationId } = job.data;
    const obligation = await this.obligationRepo.findOne({ where: { id: payoutObligationId } });
    if (!obligation) return;

    const reason = obligation.lastFailureReason || job.data.reason || 'motivo nao especificado';

    try {
      await this.notificationAdapter.notifyFailure({
        creatorId: obligation.creatorId,
        payoutObligationId: obligation.id,
        reason,
      });
    } catch (error) {
      this.logger.warn(
        `notify-payout-failure adapter call failed for obligation ${obligation.id}: ${(error as Error).message}`,
      );
    }

    obligation.failureNotificationSentAt = new Date();
    await this.obligationRepo.save(obligation);
  }
}
