import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser, CreatorPortalRoute } from '../common/decorators';
import { PayoutObligationService } from './payout-obligation.service';
import { TaxDocumentService } from './tax-document.service';
import { PayoutObligationStatus } from '../database/entities';
import {
  AuditResource,
  FinancialAccessAuditInterceptor,
} from './financial-access-audit.interceptor';

// US-36a / US-36b (section 4.3 of the E6 architecture doc). Creator-portal
// endpoints, authenticated with E3's CreatorAuthGuard, unchanged.
@Controller('creator-portal/payout-obligations')
@UseGuards(CreatorAuthGuard)
@CreatorPortalRoute()
@UseInterceptors(FinancialAccessAuditInterceptor)
export class CreatorPortalPayoutController {
  constructor(
    private payoutObligationService: PayoutObligationService,
    private taxDocumentService: TaxDocumentService,
  ) {}

  @Get()
  @AuditResource('payout_obligation')
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentUser() user: any,
    @Query('status') status?: PayoutObligationStatus,
    @Query('campaign_id') campaignId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payoutObligationService.listForCreator(user.creatorId, {
      status,
      campaignId,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @AuditResource('payout_obligation')
  @HttpCode(HttpStatus.OK)
  async detail(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payoutObligationService.getForCreator(id, user.creatorId);
  }

  @Get(':id/statement')
  @AuditResource('payout_obligation')
  @HttpCode(HttpStatus.OK)
  async statement(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payoutObligationService.getStatement(id, user.creatorId);
  }

  @Get(':id/tax-document')
  @AuditResource('tax_document')
  @HttpCode(HttpStatus.OK)
  async taxDocument(@Param('id') id: string, @CurrentUser() user: any) {
    return this.taxDocumentService.getForCreator(id, user.creatorId);
  }
}
