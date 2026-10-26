import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { BriefingService } from './briefing.service';
import { UpsertBriefingDto } from './dto/upsert-briefing.dto';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

// US-18a (compose) and US-18b (issue/distribute), section 4.2 of the E5
// architecture doc.
@Controller('campaigns')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class BriefingController {
  constructor(private briefingService: BriefingService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      correlationId: (req as any).correlationId,
    };
  }

  @Get(':id/briefing')
  @HttpCode(HttpStatus.OK)
  async getBriefing(@Param('id') id: string, @Req() req: Request) {
    return this.briefingService.getBriefing(id, (req as any).currentAccountId);
  }

  @Put(':id/briefing')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async upsertBriefing(@Param('id') id: string, @Body() dto: UpsertBriefingDto, @Req() req: Request) {
    return this.briefingService.upsertBriefing(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext((req as any).user, req),
    );
  }

  @Post(':id/briefing/issue')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async issueBriefing(@Param('id') id: string, @Req() req: Request) {
    return this.briefingService.issueBriefing(
      id,
      (req as any).currentAccountId,
      this.actorContext((req as any).user, req),
    );
  }

  @Get(':id/briefing/distribution')
  @HttpCode(HttpStatus.OK)
  async getDistribution(@Param('id') id: string, @Req() req: Request) {
    return this.briefingService.getDistribution(id, (req as any).currentAccountId);
  }
}
