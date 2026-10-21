import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { InvitationService } from './invitation.service';
import { ConfirmClaimDto } from './dto';
import { Public } from '../common/decorators';

// US-23.2 (section 4.3-4.5 of the E8 architecture doc). Public: gated by
// possession of the invitation's own cryptographically random token, the
// same bearer-token-as-capability pattern E1's workspace invitation.token
// already uses (section 2.4).
@Controller('creator-portal/invitations')
@Public()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CreatorClaimController {
  constructor(private invitationService: InvitationService) {}

  private actorContext(req: Request) {
    return { ipAddress: req.ip || '', userAgent: req.headers['user-agent'] || '' };
  }

  @Get(':token')
  @HttpCode(HttpStatus.OK)
  async preview(@Param('token') token: string) {
    return this.invitationService.previewInvitation(token);
  }

  @Post(':token/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('token') token: string, @Body() dto: ConfirmClaimDto) {
    return this.invitationService.confirmClaim(token, dto);
  }

  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  async decline(@Param('token') token: string, @Req() req: Request) {
    return this.invitationService.declineInvitation(token, this.actorContext(req));
  }
}
