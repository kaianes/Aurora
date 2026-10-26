import {
  Controller,
  Get,
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
import { BriefingQaService } from './briefing-qa.service';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

// Brand side of US-31's Q&A thread, section 4.3 of the E5 architecture doc.
@Controller('campaigns')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class BriefingQaController {
  constructor(private briefingQaService: BriefingQaService) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Get(':id/briefing/qa')
  @HttpCode(HttpStatus.OK)
  async listThreads(@Param('id') id: string, @Req() req: Request) {
    return this.briefingQaService.listThreads(id, (req as any).currentAccountId);
  }

  @Get(':id/briefing/qa/:threadId')
  @HttpCode(HttpStatus.OK)
  async getThreadDetail(@Param('id') id: string, @Param('threadId') threadId: string, @Req() req: Request) {
    return this.briefingQaService.getThreadDetail(id, threadId, (req as any).currentAccountId);
  }

  @Post(':id/briefing/qa/:threadId/messages')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async answerQuestion(
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body() dto: AnswerQuestionDto,
    @Req() req: Request,
  ) {
    return this.briefingQaService.answerQuestion(
      id,
      threadId,
      (req as any).currentAccountId,
      dto.body,
      this.actorContext((req as any).user, req),
    );
  }
}
