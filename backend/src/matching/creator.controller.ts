import { Controller, Get, Param, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { CreatorMetricsService } from './creator-metrics.service';

@Controller('creators')
export class CreatorController {
  constructor(private creatorMetricsService: CreatorMetricsService) {}

  @Get(':id/metrics')
  @HttpCode(HttpStatus.OK)
  async getMetrics(
    @Param('id') id: string,
    @Query('campaign_id') campaignId: string,
    @Req() req: Request,
  ) {
    return this.creatorMetricsService.getMetrics(
      id,
      (req as any).currentAccountId,
      campaignId,
    );
  }
}
