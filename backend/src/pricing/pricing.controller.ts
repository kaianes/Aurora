import { Controller, Get, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/decorators';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(private pricingService: PricingService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async getPricing(@Res() res: Response) {
    const pricing = await this.pricingService.getPricing();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(pricing);
  }
}
