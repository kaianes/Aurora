import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { BriefingQaService } from './briefing-qa.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser } from '../common/decorators';

// Creator side of US-30 (briefing view) and US-31 (Q&A), section 4.3 of the
// E5 architecture doc. Authenticated with a creator JWT (E3's
// CreatorAuthGuard, reused unchanged).
@Controller('creator-portal')
@UseGuards(CreatorAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CreatorPortalBriefingController {
  constructor(private briefingQaService: BriefingQaService) {}

  private actorContext(req: Request) {
    return { ipAddress: req.ip || '', userAgent: req.headers['user-agent'] || '' };
  }

  @Get('briefing')
  @HttpCode(HttpStatus.OK)
  async getBriefing(@Query('campaign_id') campaignId: string, @CurrentUser() user: any) {
    return this.briefingQaService.getBriefingForCreator(campaignId, user.creatorId);
  }

  @Post('briefing/qa')
  @HttpCode(HttpStatus.CREATED)
  async askQuestion(@Body() dto: AskQuestionDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.briefingQaService.askQuestion(dto.campaign_id, user.creatorId, dto.question, this.actorContext(req));
  }

  @Get('briefing/qa')
  @HttpCode(HttpStatus.OK)
  async getOwnThread(@Query('campaign_id') campaignId: string, @CurrentUser() user: any) {
    return this.briefingQaService.getOwnThread(campaignId, user.creatorId);
  }
}
