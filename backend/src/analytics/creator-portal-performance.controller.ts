import { Controller, Get, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser } from '../common/decorators';
import { CreatorPerformanceService } from './creator-performance.service';

// US-37 / FR-54, section 5.4 of the E7 architecture document. Reuses E3's
// CreatorAuthGuard unchanged.
@Controller('creator-portal/performance')
@UseGuards(CreatorAuthGuard)
export class CreatorPortalPerformanceController {
  constructor(private creatorPerformanceService: CreatorPerformanceService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getOwnPerformance(@CurrentUser() user: any) {
    return this.creatorPerformanceService.getOwnPerformance(user.creatorId);
  }
}
