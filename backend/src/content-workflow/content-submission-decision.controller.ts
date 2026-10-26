import { Controller, Post, Param, Body, Req, HttpCode, HttpStatus, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { ReviewDecisionService } from './review-decision.service';
import { DecideSubmissionDto } from './dto/decide-submission.dto';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

// US-19: Marina's approve/reject/request-revision decision, section 4.5 of
// the E5 architecture doc.
@Controller('content-submissions')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ContentSubmissionDecisionController {
  constructor(private reviewDecisionService: ReviewDecisionService) {}

  @Post(':id/decide')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async decide(@Param('id') id: string, @Body() dto: DecideSubmissionDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.reviewDecisionService.decide(id, (req as any).currentAccountId, dto, {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });
  }
}
