import { Controller, Post, Get, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { ClientReportService } from './client-report.service';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

// US-43 / FR-55, section 5.5 of the E7 architecture document. The caller's
// X-Account-Id is set to clientAccountId itself (section 2.5) -- RolesGuard
// has already resolved whether this caller may act on that client account
// by the time either handler runs, which is what makes scenario 3's
// refusal automatic.
@Controller('agency/clients/:clientAccountId/reports')
@Roles(Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR)
export class AgencyClientReportController {
  constructor(private clientReportService: ClientReportService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestReport(@Param('clientAccountId') clientAccountId: string, @Req() req: Request) {
    return this.clientReportService.requestReport(clientAccountId, (req as any).user?.sub);
  }

  @Get(':reportId')
  @HttpCode(HttpStatus.OK)
  async getReport(
    @Param('clientAccountId') clientAccountId: string,
    @Param('reportId') reportId: string,
  ) {
    return this.clientReportService.getReport(clientAccountId, reportId);
  }
}
