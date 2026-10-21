import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
  PayoutObligation,
  PayoutExecutionAttempt,
  LedgerEntry,
  TaxDocument,
  Invoice,
  InvoiceLineItem,
  CampaignOpportunity,
  Campaign,
  Account,
  Creator,
  User,
  PoolShortfallResolution,
} from '../database/entities';
import { PayoutObligationService } from './payout-obligation.service';
import { LedgerService } from './ledger.service';
import { InvoiceService } from './invoice.service';
import { TaxDocumentService } from './tax-document.service';
import { OperatorAuthGuard } from './operator-auth.guard';
import { FinancialAccessAuditInterceptor } from './financial-access-audit.interceptor';
import { CreatorPortalPayoutController } from './creator-portal-payout.controller';
import { OpsPayoutController } from './ops-payout.controller';
import { InvoiceController } from './invoice.controller';
import { AttemptPayoutExecutionProcessor } from './attempt-payout-execution.processor';
import { NotifyPayoutFailureProcessor } from './notify-payout-failure.processor';
import { GenerateTaxDocumentProcessor } from './generate-tax-document.processor';
import { PaymentsScheduledTasksService } from './payments-scheduled-tasks.service';
import {
  PAYOUT_EXECUTION_ADAPTER,
  StubPayoutExecutionAdapter,
} from './adapters/payout-execution.adapter';
import {
  PAYOUT_NOTIFICATION_ADAPTER,
  StubPayoutNotificationAdapter,
} from './adapters/payout-notification.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayoutObligation,
      PayoutExecutionAttempt,
      LedgerEntry,
      TaxDocument,
      Invoice,
      InvoiceLineItem,
      CampaignOpportunity,
      Campaign,
      Account,
      Creator,
      User,
      PoolShortfallResolution,
    ]),
    BullModule.registerQueue({ name: 'payments' }),
  ],
  controllers: [CreatorPortalPayoutController, OpsPayoutController, InvoiceController],
  providers: [
    PayoutObligationService,
    LedgerService,
    InvoiceService,
    TaxDocumentService,
    OperatorAuthGuard,
    FinancialAccessAuditInterceptor,
    AttemptPayoutExecutionProcessor,
    NotifyPayoutFailureProcessor,
    GenerateTaxDocumentProcessor,
    PaymentsScheduledTasksService,
    StubPayoutExecutionAdapter,
    StubPayoutNotificationAdapter,
    {
      // ADR-0033: swapping in a real adapter is a one-line change here --
      // no table, controller, or other module's code changes (NFR-36).
      provide: PAYOUT_EXECUTION_ADAPTER,
      useExisting: StubPayoutExecutionAdapter,
    },
    {
      provide: PAYOUT_NOTIFICATION_ADAPTER,
      useExisting: StubPayoutNotificationAdapter,
    },
  ],
  // PayoutObligationService.createForConfirmedPublication is the only
  // method content-workflow's PublicationService calls (ADR-0036); nothing
  // else in this module is exported.
  exports: [PayoutObligationService],
})
export class PaymentsModule {}
