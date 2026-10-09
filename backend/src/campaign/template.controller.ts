import {
  Controller,
  Post,
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
import { TemplateService } from './template.service';
import { SaveTemplateDto } from './dto/save-template.dto';
import { InstantiateTemplateDto } from './dto/instantiate-template.dto';
import { AcknowledgeDriftDto } from './dto/acknowledge-drift.dto';
import { Roles, CurrentUser } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [
  Role.BRAND_OWNER,
  Role.BRAND_MANAGER,
  Role.AGENCY_ADMIN,
  Role.AGENCY_OPERATOR,
];

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller()
export class TemplateController {
  constructor(private templateService: TemplateService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Post('campaigns/:id/save-as-template')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async saveAsTemplate(
    @Param('id') id: string,
    @Body() dto: SaveTemplateDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.templateService.saveAsTemplate(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Get('campaign-templates')
  @HttpCode(HttpStatus.OK)
  async list(@Req() req: Request) {
    return this.templateService.list((req as any).currentAccountId);
  }

  @Post('campaign-templates/:id/instantiate')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async instantiate(
    @Param('id') id: string,
    @Body() dto: InstantiateTemplateDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.templateService.instantiate(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Post('campaigns/:id/acknowledge-drift')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async acknowledgeDrift(
    @Param('id') id: string,
    @Body() dto: AcknowledgeDriftDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.templateService.acknowledgeDrift(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }
}
