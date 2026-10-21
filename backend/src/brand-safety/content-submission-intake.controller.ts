import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ContentSubmissionService } from './content-submission.service';
import { CreateContentSubmissionDto } from './dto/create-content-submission.dto';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser } from '../common/decorators';

// US-16, ADR-0020: the one creator-facing endpoint this epic exposes, so
// US-16 is testable end to end before E5 ships a real structured
// draft-submission flow. Authenticates with a creator JWT (E3's
// CreatorAuthGuard), not an account role -- creators are not members of any
// account (section 3.3 of the E4 architecture doc).
@Controller('creator-portal')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ContentSubmissionIntakeController {
  constructor(private contentSubmissionService: ContentSubmissionService) {}

  @UseGuards(CreatorAuthGuard)
  @Post('content-submissions')
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Body() dto: CreateContentSubmissionDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.contentSubmissionService.createSubmission(dto, user.creatorId, {
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });
  }
}
