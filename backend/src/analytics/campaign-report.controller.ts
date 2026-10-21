import { Controller, Post, Get, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { CampaignReportService } from './campaign-report.service';

// US-22 / FR-53, section 5.3 of the E7 architecture document. Any
// authenticated member with account access (section 2.4: generating or
// viewing a report is a read-only action, not a financial commitment).
@Controller('campaigns/:id/reports')
export class CampaignReportController {
  constructor(private campaignReportService: CampaignReportService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestReport(@Param('id') campaignId: string, @Req() req: Request) {
    return this.campaignReportService.requestReport(
      campaignId,
      (req as any).currentAccountId,
      (req as any).user?.sub,
    );
  }

  @Get(':reportId')
  @HttpCode(HttpStatus.OK)
  async getReport(
    @Param('id') campaignId: string,
    @Param('reportId') reportId: string,
    @Req() req: Request,
  ) {
    return this.campaignReportService.getReport(campaignId, reportId, (req as any).currentAccountId);
  }
}
