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
import { ContentSubmissionService, CheckStatusActor } from './content-submission.service';
import { BrandSafetyGateService } from './brand-safety-gate.service';
import { RecordPublicationDto } from './dto/record-publication.dto';
import { CurrentUser, Roles } from '../common/decorators';
import { Role } from '../database/entities';

const WRITE_ROLES = [Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

// US-16 / US-16 scenario 3 / section 3.6 of the E4 architecture doc.
@Controller('safety/submissions')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class SafetyCheckController {
  constructor(
    private contentSubmissionService: ContentSubmissionService,
    private gateService: BrandSafetyGateService,
  ) {}

  // Available to the submitting creator (own submissions only) and to any
  // authenticated account member with access to the submission's campaign
  // (section 3.3 of the E4 architecture doc) -- both actor types carry a
  // valid JWT, so no extra guard is needed beyond the global JwtAuthGuard.
  @Get(':id/check')
  @HttpCode(HttpStatus.OK)
  async getCheck(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    const actor: CheckStatusActor = user?.isCreator
      ? { isCreator: true, creatorId: user.creatorId }
      : { isCreator: false, currentAccountId: (req as any).currentAccountId };
    return this.contentSubmissionService.getCheckStatus(id, actor);
  }

  // Thin authenticated HTTP wrapper for BrandSafetyGateService.recordPublication
  // (section 3.6), reachable until E5 exists to call the method directly.
  @Post(':id/record-publication')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async recordPublication(
    @Param('id') id: string,
    @Body() dto: RecordPublicationDto,
    @Req() req: Request,
  ) {
    // Tenant isolation at this HTTP boundary -- the gate service's own
    // exported contract takes no accountId (it is the fixed interface a
    // future E5 calls directly in-process).
    await this.contentSubmissionService.findSubmissionForAccountOrFail(
      id,
      (req as any).currentAccountId,
    );
    await this.gateService.recordPublication(id, dto.published_url);
    return { content_submission_id: id, recorded: true };
  }
}
