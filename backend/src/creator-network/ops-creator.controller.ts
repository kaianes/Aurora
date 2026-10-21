import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { OperatorAuthGuard } from '../payments/operator-auth.guard';
import { UnclaimedProfileService } from './unclaimed-profile.service';
import { InvitationService } from './invitation.service';
import { DataSubjectRequestService } from './data-subject-request.service';
import {
  CreateUnclaimedProfileDto,
  CreateInvitationDto,
  CreateDataSubjectRequestDto,
  FulfillDataSubjectRequestDto,
} from './dto';

// Sections 4.1, 4.2, 8 of the E8 architecture doc. Every endpoint here
// requires the aurora_operator principal (OperatorAuthGuard, reused
// unchanged from payments, ADR-0038) -- no new guard is introduced.
@Controller('ops/creators')
@UseGuards(OperatorAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OpsCreatorController {
  constructor(
    private unclaimedProfileService: UnclaimedProfileService,
    private invitationService: InvitationService,
    private dataSubjectRequestService: DataSubjectRequestService,
  ) {}

  private actorContext(req: Request) {
    return { ipAddress: req.ip || '', userAgent: req.headers['user-agent'] || '' };
  }

  @Post('unclaimed')
  @HttpCode(HttpStatus.CREATED)
  async createUnclaimedProfile(
    @Body() dto: CreateUnclaimedProfileDto,
    @Req() req: Request,
  ) {
    const operatorUserId = (req as any).auroraOperatorUserId;
    return this.unclaimedProfileService.createUnclaimedProfile(
      dto,
      operatorUserId,
      this.actorContext(req),
    );
  }

  @Post(':id/invitations')
  @HttpCode(HttpStatus.CREATED)
  async dispatchInvitation(
    @Param('id') creatorId: string,
    @Body() dto: CreateInvitationDto,
    @Req() req: Request,
  ) {
    const operatorUserId = (req as any).auroraOperatorUserId;
    return this.invitationService.dispatchInvitation(
      creatorId,
      dto,
      operatorUserId,
      this.actorContext(req),
    );
  }

  @Post(':id/data-subject-requests')
  @HttpCode(HttpStatus.CREATED)
  async createDataSubjectRequest(
    @Param('id') creatorId: string,
    @Body() dto: CreateDataSubjectRequestDto,
    @Req() req: Request,
  ) {
    const operatorUserId = (req as any).auroraOperatorUserId;
    return this.dataSubjectRequestService.create(
      creatorId,
      dto,
      operatorUserId,
      this.actorContext(req),
    );
  }

  @Patch(':id/data-subject-requests/:requestId')
  @HttpCode(HttpStatus.OK)
  async fulfillDataSubjectRequest(
    @Param('id') creatorId: string,
    @Param('requestId') requestId: string,
    @Body() dto: FulfillDataSubjectRequestDto,
    @Req() req: Request,
  ) {
    const operatorUserId = (req as any).auroraOperatorUserId;
    return this.dataSubjectRequestService.fulfill(
      creatorId,
      requestId,
      dto,
      operatorUserId,
      this.actorContext(req),
    );
  }
}
