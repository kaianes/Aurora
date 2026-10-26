import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser } from '../common/decorators';
import { RatePreferenceService } from './rate-preference.service';
import { SetRatePreferenceDto } from './dto';

// US-27 (section 7 of the E8 architecture doc).
@Controller('creator-portal/rate-preferences')
@UseGuards(CreatorAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class RatePreferenceController {
  constructor(private ratePreferenceService: RatePreferenceService) {}

  @Put(':deliverableFormat')
  @HttpCode(HttpStatus.OK)
  async setRate(
    @Param('deliverableFormat') deliverableFormat: string,
    @Body() dto: SetRatePreferenceDto,
    @CurrentUser() user: any,
  ) {
    return this.ratePreferenceService.setRate(user.creatorId, deliverableFormat, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listRates(@CurrentUser() user: any) {
    return this.ratePreferenceService.listRates(user.creatorId);
  }
}
