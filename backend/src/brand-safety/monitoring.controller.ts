import { Controller, Get, Param, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { MonitoringService } from './monitoring.service';

// US-16b.
@Controller('safety/monitoring')
export class MonitoringController {
  constructor(private monitoringService: MonitoringService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('campaign_id') campaignId: string,
    @Query('result') result: string,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    return this.monitoringService.list(
      (req as any).currentAccountId,
      campaignId,
      result,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getDetail(@Param('id') id: string, @Req() req: Request) {
    return this.monitoringService.getDetail(id, (req as any).currentAccountId);
  }
}
