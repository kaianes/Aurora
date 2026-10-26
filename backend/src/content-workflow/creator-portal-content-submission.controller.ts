import {
  Controller,
  Get,
  Post,
  Param,
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
import { DraftSubmissionService } from './draft-submission.service';
import { PublicationService } from './publication.service';
import { ConfirmPublicationDto } from './dto/confirm-publication.dto';
import { CreateContentSubmissionDto } from '../brand-safety/dto/create-content-submission.dto';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser, CreatorPortalRoute } from '../common/decorators';

// Replaces E4's stub ContentSubmissionIntakeController at the same route
// (ADR-0032, section 4.4/7.4 of the E5 architecture doc) -- US-32a (intake),
// US-32a/US-32b/US-33 (version history, read side), and US-34 (publication
// confirmation, FR-42).
@Controller('creator-portal')
@UseGuards(CreatorAuthGuard)
@CreatorPortalRoute()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CreatorPortalContentSubmissionController {
  constructor(
    private draftSubmissionService: DraftSubmissionService,
    private publicationService: PublicationService,
  ) {}

  private actorContext(req: Request) {
    return { ipAddress: req.ip || '', userAgent: req.headers['user-agent'] || '' };
  }

  @Post('content-submissions')
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() dto: CreateContentSubmissionDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.draftSubmissionService.createDraft(dto, user.creatorId, this.actorContext(req));
  }

  @Get('content-submissions')
  @HttpCode(HttpStatus.OK)
  async list(@Query('opportunity_id') opportunityId: string, @CurrentUser() user: any) {
    return this.draftSubmissionService.listForCreator(user.creatorId, opportunityId);
  }

  @Post('content-submissions/:id/confirm-publication')
  @HttpCode(HttpStatus.OK)
  async confirmPublication(
    @Param('id') id: string,
    @Body() dto: ConfirmPublicationDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.publicationService.confirmPublication(id, user.creatorId, dto, this.actorContext(req));
  }
}
