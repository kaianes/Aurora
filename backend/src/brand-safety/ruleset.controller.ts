import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RulesetService } from './ruleset.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { BulkRulesDto } from './dto/bulk-rules.dto';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

// US-15: brand-level ruleset and rule CRUD.
@Controller('safety/rulesets/brand')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class RulesetController {
  constructor(private rulesetService: RulesetService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async getBrandRuleset(@Req() req: Request) {
    return this.rulesetService.getBrandRuleset((req as any).currentAccountId);
  }

  @Post('rules')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async createRule(@Body() dto: CreateRuleDto, @Req() req: Request) {
    return this.rulesetService.createBrandRule(
      (req as any).currentAccountId,
      dto,
      this.actorContext((req as any).user, req),
    );
  }

  @Patch('rules/:ruleId')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async updateRule(
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateRuleDto,
    @Req() req: Request,
  ) {
    return this.rulesetService.updateBrandRule(
      (req as any).currentAccountId,
      ruleId,
      dto,
      this.actorContext((req as any).user, req),
    );
  }

  @Delete('rules/:ruleId')
  @Roles(...WRITE_ROLES)
  async deleteRule(@Param('ruleId') ruleId: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.rulesetService.deleteBrandRule(
      (req as any).currentAccountId,
      ruleId,
      this.actorContext((req as any).user, req),
    );
    if (result) {
      res.status(HttpStatus.OK).json(result);
    } else {
      res.status(HttpStatus.NO_CONTENT).send();
    }
  }

  @Post('rules/bulk')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async bulkRules(@Body() dto: BulkRulesDto, @Req() req: Request) {
    return this.rulesetService.bulkBrandRules(
      (req as any).currentAccountId,
      dto,
      this.actorContext((req as any).user, req),
    );
  }
}
