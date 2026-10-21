import { Controller, Get, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { ClientComparisonService } from './client-comparison.service';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

// US-46 / FR-56, section 5.6 of the E7 architecture document (ADR-0048).
// The caller's X-Account-Id is their own agency home account (not a
// client); app.current_workspace_id is resolved server-side from that
// membership, never accepted as client input.
@Controller('agency/reports')
export class AgencyReportCompareController {
  constructor(private clientComparisonService: ClientComparisonService) {}

  @Get('compare')
  @Roles(Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR)
  @HttpCode(HttpStatus.OK)
  async compare(@Query('client_account_ids') clientAccountIds: string, @Req() req: Request) {
    const ids = (clientAccountIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    return this.clientComparisonService.compareClients(
      (req as any).currentAccountId,
      (req as any).user?.sub,
      (req as any).currentRole,
      ids,
    );
  }
}
