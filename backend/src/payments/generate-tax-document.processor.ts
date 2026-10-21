import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TaxDocumentService } from './tax-document.service';

// US-36b / FR-50 (ADR-0041). Enqueued on settlement, automatic or manual.
@Processor('payments')
export class GenerateTaxDocumentProcessor {
  private readonly logger = new Logger(GenerateTaxDocumentProcessor.name);

  constructor(private taxDocumentService: TaxDocumentService) {}

  @Process('generate-tax-document')
  async handle(job: Job<{ payoutObligationId: string }>) {
    try {
      await this.taxDocumentService.generateForSettledObligation(job.data.payoutObligationId);
    } catch (error) {
      this.logger.warn(
        `generate-tax-document failed for obligation ${job.data.payoutObligationId}: ${(error as Error).message}`,
      );
    }
  }
}
