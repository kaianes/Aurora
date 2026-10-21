import { Controller, Get, Param, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { DraftSubmissionService } from './draft-submission.service';

// Marina's review queue, brand side (US-19/US-32a/US-32b read side), section
// 4.4 of the E5 architecture doc.
@Controller('campaigns')
export class CampaignContentSubmissionController {
  constructor(private draftSubmissionService: DraftSubmissionService) {}

  @Get(':id/content-submissions')
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('id') id: string,
    @Query('opportunity_id') opportunityId: string,
    @Query('review_status') reviewStatus: string,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    return this.draftSubmissionService.listForBrand(id, (req as any).currentAccountId, {
      opportunityId,
      reviewStatus,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
