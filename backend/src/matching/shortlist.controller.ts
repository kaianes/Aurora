import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ShortlistService } from './shortlist.service';
import { DecisionDto } from './dto/decision.dto';
import { BulkDecisionDto } from './dto/bulk-decision.dto';
import { OverrideShortlistDto } from './dto/override-shortlist.dto';
import { Roles, CurrentUser } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [
  Role.BRAND_OWNER,
  Role.BRAND_MANAGER,
  Role.AGENCY_ADMIN,
  Role.AGENCY_OPERATOR,
];

const OVERRIDE_ROLES = [Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

@Controller('campaigns')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ShortlistController {
  constructor(private shortlistService: ShortlistService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Post(':id/shortlist')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.ACCEPTED)
  async requestShortlist(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.shortlistService.requestShortlist(
      id,
      (req as any).currentAccountId,
      this.actorContext(user, req),
    );
  }

  @Get(':id/shortlist')
  @HttpCode(HttpStatus.OK)
  async getShortlist(@Param('id') id: string, @Req() req: Request) {
    return this.shortlistService.getShortlist(id, (req as any).currentAccountId);
  }

  @Patch(':id/shortlist/entries/bulk')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async bulkDecide(
    @Param('id') id: string,
    @Body() dto: BulkDecisionDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.shortlistService.bulkDecide(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Patch(':id/shortlist/entries/:entryId')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async decideEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: DecisionDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.shortlistService.decideEntry(
      id,
      entryId,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Post(':id/shortlist/request-additional-candidates')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.ACCEPTED)
  async requestAdditionalCandidates(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.shortlistService.requestAdditionalCandidates(
      id,
      (req as any).currentAccountId,
      this.actorContext(user, req),
    );
  }

  @Post(':id/shortlist/override')
  @Roles(...OVERRIDE_ROLES)
  @HttpCode(HttpStatus.OK)
  async overrideShortlist(
    @Param('id') id: string,
    @Body() dto: OverrideShortlistDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.shortlistService.overrideShortlist(
      id,
      (req as any).currentAccountId,
      (req as any).currentRole,
      user.sub,
      dto,
      this.actorContext(user, req),
    );
  }
}
