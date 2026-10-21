import {
  Controller,
  Get,
  Post,
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
import { ReviewQueueService } from './review-queue.service';
import { DecideReviewDto } from './dto/decide-review.dto';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

// US-17.
@Controller('safety/review-queue')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ReviewQueueController {
  constructor(private reviewQueueService: ReviewQueueService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('status') status: string,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    return this.reviewQueueService.list(
      (req as any).currentAccountId,
      status || 'pending',
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getDetail(@Param('id') id: string, @Req() req: Request) {
    return this.reviewQueueService.getDetail(id, (req as any).currentAccountId);
  }

  @Post(':id/decide')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async decide(@Param('id') id: string, @Body() dto: DecideReviewDto, @Req() req: Request) {
    return this.reviewQueueService.decide(
      id,
      (req as any).currentAccountId,
      dto,
      this.actorContext((req as any).user, req),
    );
  }
}
