import {
  Controller,
  Post,
  Patch,
  Get,
  Put,
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
import { CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { LifecycleActionDto } from './dto/lifecycle-action.dto';
import { ResolveShortfallDto } from './dto/resolve-shortfall.dto';
import { ReallocationBoundsDto } from './dto/reallocation-bounds.dto';
import { Roles, CurrentUser } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [
  Role.BRAND_OWNER,
  Role.BRAND_MANAGER,
  Role.AGENCY_ADMIN,
  Role.AGENCY_OPERATOR,
];

const SHORTFALL_RESOLVE_ROLES = [Role.BRAND_OWNER, Role.AGENCY_ADMIN];

@Controller('campaigns')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CampaignController {
  constructor(private campaignService: CampaignService) {}

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
  async create(@Body() dto: CreateCampaignDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.campaignService.create(
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.campaignService.update(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string, @Req() req: Request) {
    return this.campaignService.findOne(id, (req as any).currentAccountId);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('state') state: string,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    return this.campaignService.list(
      (req as any).currentAccountId,
      state,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post(':id/quote')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.ACCEPTED)
  async requestQuote(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.campaignService.requestQuote(
      id,
      (req as any).currentAccountId,
      this.actorContext(user, req),
    );
  }

  @Get(':id/quote/:quoteId')
  @HttpCode(HttpStatus.OK)
  async getQuote(
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @Req() req: Request,
  ) {
    return this.campaignService.getQuote(id, quoteId, (req as any).currentAccountId);
  }

  @Post(':id/confirm')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.campaignService.confirm(
      id,
      (req as any).currentAccountId,
      this.actorContext(user, req),
    );
  }

  @Get(':id/shortfall')
  @HttpCode(HttpStatus.OK)
  async getShortfall(@Param('id') id: string, @Req() req: Request) {
    return this.campaignService.getShortfall(id, (req as any).currentAccountId);
  }

  @Post(':id/shortfall/resolve')
  @Roles(...SHORTFALL_RESOLVE_ROLES)
  @HttpCode(HttpStatus.OK)
  async resolveShortfall(
    @Param('id') id: string,
    @Body() dto: ResolveShortfallDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.campaignService.resolveShortfall(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Post(':id/pause')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async pause(
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.campaignService.pause(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Post(':id/resume')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async resume(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.campaignService.resume(
      id,
      (req as any).currentAccountId,
      this.actorContext(user, req),
    );
  }

  @Post(':id/cancel')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.campaignService.cancel(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Put(':id/reallocation-bounds')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async setReallocationBounds(
    @Param('id') id: string,
    @Body() dto: ReallocationBoundsDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.campaignService.setReallocationBounds(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext(user, req),
    );
  }

  @Get(':id/reallocation-events')
  @HttpCode(HttpStatus.OK)
  async listReallocationEvents(@Param('id') id: string, @Req() req: Request) {
    return this.campaignService.listReallocationEvents(id, (req as any).currentAccountId);
  }
}
