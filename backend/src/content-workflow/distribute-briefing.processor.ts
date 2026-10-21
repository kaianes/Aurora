import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import { BriefingDistributionRecipient, DistributionRecipientStatus } from '../database/entities';
import {
  BRIEFING_NOTIFICATION_ADAPTER,
  BriefingNotificationAdapter,
} from './adapters/briefing-notification.adapter';

// US-18b's asynchronous fan-out tail (section 5 of the E5 architecture doc):
// one attempt per recipient per issue action, never retried indefinitely --
// this is a one-time broadcast, not a queued message with its own retry
// policy.
@Processor('content-workflow')
export class DistributeBriefingProcessor {
  private readonly logger = new Logger(DistributeBriefingProcessor.name);

  constructor(
    @InjectRepository(BriefingDistributionRecipient)
    private recipientRepo: Repository<BriefingDistributionRecipient>,
    @Inject(BRIEFING_NOTIFICATION_ADAPTER)
    private notificationAdapter: BriefingNotificationAdapter,
  ) {}

  @Process('distribute-briefing')
  async handleDistributeBriefing(job: Job<{ briefingId: string; campaignId: string; correlationId?: string }>) {
    const { briefingId } = job.data;
    const recipients = await this.recipientRepo.find({
      where: { briefingId, status: DistributionRecipientStatus.PENDING },
    });

    for (const recipient of recipients) {
      try {
        const result = await this.notificationAdapter.deliver(recipient.creatorId, briefingId);
        if (result.delivered) {
          recipient.status = DistributionRecipientStatus.DELIVERED;
          recipient.deliveredAt = new Date();
        } else {
          recipient.status = DistributionRecipientStatus.FAILED;
          recipient.failureReason = result.failureReason || 'notification_provider_error';
        }
      } catch (error) {
        recipient.status = DistributionRecipientStatus.FAILED;
        recipient.failureReason = 'notification_provider_error';
        this.logger.warn(
          `distribute-briefing delivery failed for creator ${recipient.creatorId}: ${(error as Error).message}`,
        );
      }
      await this.recipientRepo.save(recipient);
    }
  }
}
