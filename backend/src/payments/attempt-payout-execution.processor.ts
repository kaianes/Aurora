import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import { PayoutObligation, PayoutObligationStatus } from '../database/entities';
import { PayoutObligationService } from './payout-obligation.service';
import {
  PAYOUT_EXECUTION_ADAPTER,
  PayoutExecutionAdapter,
} from './adapters/payout-execution.adapter';

// Section 5 of the E6 architecture doc: enqueued immediately after a
// payout_obligation commits, and again by retry-unexecuted-payouts.
// ADR-0033: the only two callers of PayoutExecutionAdapter.executeTransfer
// are this processor and poll-in-flight-payouts.
@Processor('payments')
export class AttemptPayoutExecutionProcessor {
  private readonly logger = new Logger(AttemptPayoutExecutionProcessor.name);

  constructor(
    @InjectRepository(PayoutObligation)
    private obligationRepo: Repository<PayoutObligation>,
    @Inject(PAYOUT_EXECUTION_ADAPTER)
    private executionAdapter: PayoutExecutionAdapter,
    private payoutObligationService: PayoutObligationService,
  ) {}

  @Process('attempt-payout-execution')
  async handle(job: Job<{ payoutObligationId: string }>) {
    const { payoutObligationId } = job.data;
    const obligation = await this.obligationRepo.findOne({ where: { id: payoutObligationId } });
    // Already in_flight or settled (a duplicate/redelivered job, or a race
    // with another attempt) -- no-op, idempotent by construction.
    if (!obligation || obligation.status !== PayoutObligationStatus.OWED) {
      return;
    }

    try {
      const result = await this.executionAdapter.executeTransfer({
        payoutObligationId: obligation.id,
        creatorId: obligation.creatorId,
        amount: obligation.payoutNet,
        idempotencyKey: obligation.id,
      });

      if (result.outcome === 'instructed') {
        await this.payoutObligationService.recordInstructed(obligation.id, result.providerReference);
      } else {
        await this.payoutObligationService.recordScheduledFailure(obligation.id, result.reason);
      }
    } catch (error) {
      this.logger.warn(
        `attempt-payout-execution failed for obligation ${obligation.id}: ${(error as Error).message}`,
      );
      await this.payoutObligationService.recordScheduledFailure(
        obligation.id,
        'adapter_execution_error',
      );
    }
  }
}
