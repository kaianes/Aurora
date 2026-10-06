import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ExclusionService } from './exclusion.service';
import { CreateExclusionDto } from './dto/create-exclusion.dto';
import { Roles, CurrentUser } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [
  Role.BRAND_OWNER,
  Role.BRAND_MANAGER,
  Role.AGENCY_ADMIN,
  Role.AGENCY_OPERATOR,
];

@Controller('exclusions')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ExclusionController {
  constructor(private exclusionService: ExclusionService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Post()
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateExclusionDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.exclusionService.create(
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Query('campaign_id') campaignId: string, @Req() req: Request) {
    return this.exclusionService.list((req as any).currentAccountId, campaignId);
  }

  @Delete(':id')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    await this.exclusionService.remove(
      id,
      (req as any).currentAccountId,
      this.actorContext(user, req),
    );
  }
}
