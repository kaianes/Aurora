import { Controller, Get, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { DashboardService } from './dashboard.service';

// US-21b / FR-51, section 5.2 of the E7 architecture document. Any
// authenticated member with account access (no @Roles() -- section 2.4
// grants this to every role brand_owner through agency_operator).
@Controller('campaigns')
export class CampaignDashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get(':id/dashboard')
  @HttpCode(HttpStatus.OK)
  async getDashboard(@Param('id') id: string, @Req() req: Request) {
    return this.dashboardService.getDashboard(id, (req as any).currentAccountId);
  }
}
