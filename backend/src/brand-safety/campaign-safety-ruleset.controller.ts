import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { RulesetService } from './ruleset.service';
import { CreateOverrideDto } from './dto/create-override.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { BulkOverridesDto } from './dto/bulk-overrides.dto';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

// US-15 scenario 2: campaign-level effective ruleset and overrides.
@Controller('campaigns')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CampaignSafetyRulesetController {
  constructor(private rulesetService: RulesetService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Get(':id/safety-ruleset')
  @HttpCode(HttpStatus.OK)
  async getEffectiveRuleset(@Param('id') id: string, @Req() req: Request) {
    return this.rulesetService.getEffectiveCampaignRuleset(id, (req as any).currentAccountId);
  }

  @Post(':id/safety-ruleset/overrides')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async createOverride(
    @Param('id') id: string,
    @Body() dto: CreateOverrideDto,
    @Req() req: Request,
  ) {
    return this.rulesetService.createCampaignOverride(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext((req as any).user, req),
    );
  }

  @Patch(':id/safety-ruleset/overrides/:ruleId')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async updateOverride(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateRuleDto,
    @Req() req: Request,
  ) {
    return this.rulesetService.updateCampaignOverride(
      id,
      (req as any).currentAccountId,
      ruleId,
      dto,
      this.actorContext((req as any).user, req),
    );
  }

  @Delete(':id/safety-ruleset/overrides/:ruleId')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOverride(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Req() req: Request,
  ) {
    await this.rulesetService.deleteCampaignOverride(
      id,
      (req as any).currentAccountId,
      ruleId,
      this.actorContext((req as any).user, req),
    );
  }

  @Post(':id/safety-ruleset/overrides/bulk')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async bulkOverrides(
    @Param('id') id: string,
    @Body() dto: BulkOverridesDto,
    @Req() req: Request,
  ) {
    return this.rulesetService.bulkCampaignOverrides(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext((req as any).user, req),
    );
  }
}
