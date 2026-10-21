import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { InvoiceService } from './invoice.service';
import { Roles, CurrentUser } from '../common/decorators';
import { Role } from '../database/entities';
import {
  AuditResource,
  FinancialAccessAuditInterceptor,
} from './financial-access-audit.interceptor';

// US-20 / US-42, section 4.4 of the E6 architecture doc. Roles match
// section 3.5's table: generation is a write action restricted to
// brand_owner/brand_manager/agency_admin/agency_operator; view is open to
// any authenticated member with account access, including brand_analyst.
const GENERATE_ROLES = [
  Role.BRAND_OWNER,
  Role.BRAND_MANAGER,
  Role.AGENCY_ADMIN,
  Role.AGENCY_OPERATOR,
];

@Controller('campaigns/:id/invoice')
@UseInterceptors(FinancialAccessAuditInterceptor)
export class InvoiceController {
  constructor(private invoiceService: InvoiceService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Post()
  @Roles(...GENERATE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async generate(@Param('id') campaignId: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.invoiceService.generate(
      campaignId,
      (req as any).currentAccountId,
      this.actorContext(user, req),
    );
  }

  @Get()
  @AuditResource('invoice')
  @HttpCode(HttpStatus.OK)
  async get(@Param('id') campaignId: string, @Req() req: Request) {
    return this.invoiceService.getForCampaign(campaignId, (req as any).currentAccountId);
  }
}
