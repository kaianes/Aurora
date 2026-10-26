import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { OperatorAuthGuard } from './operator-auth.guard';
import { PayoutObligationService } from './payout-obligation.service';
import { MarkSettledDto } from './dto/mark-settled.dto';
import { MarkFailedDto } from './dto/mark-failed.dto';
import { PayoutObligationStatus } from '../database/entities';
import {
  AuditResource,
  FinancialAccessAuditInterceptor,
} from './financial-access-audit.interceptor';

// Section 4.5 of the E6 architecture doc: the manual fallback (US-35b,
// US-35c), gated by the aurora_operator principal (ADR-0038), MFA-verified
// unconditionally by OperatorAuthGuard.
@Controller('ops/payout-obligations')
@UseGuards(OperatorAuthGuard)
@UseInterceptors(FinancialAccessAuditInterceptor)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OpsPayoutController {
  constructor(private payoutObligationService: PayoutObligationService) {}

  private actorContext(req: Request) {
    return { ipAddress: req.ip || '', userAgent: req.headers['user-agent'] || '' };
  }

  @Get()
  @AuditResource('payout_obligation')
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('status') status?: PayoutObligationStatus,
    @Query('escalated_for_manual_review') escalated?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payoutObligationService.listForOperator({
      status,
      escalatedForManualReview:
        escalated === undefined ? undefined : escalated === 'true',
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post(':id/mark-settled')
  @HttpCode(HttpStatus.OK)
  async markSettled(
    @Param('id') id: string,
    @Body() dto: MarkSettledDto,
    @Req() req: Request,
  ) {
    const operatorUserId = (req as any).auroraOperatorUserId;
    return this.payoutObligationService.markSettledManually(
      id,
      operatorUserId,
      dto.provider_reference || null,
      this.actorContext(req),
    );
  }

  @Post(':id/mark-failed')
  @HttpCode(HttpStatus.OK)
  async markFailed(
    @Param('id') id: string,
    @Body() dto: MarkFailedDto,
    @Req() req: Request,
  ) {
    const operatorUserId = (req as any).auroraOperatorUserId;
    return this.payoutObligationService.markFailedManually(
      id,
      operatorUserId,
      dto.reason,
      this.actorContext(req),
    );
  }
}
