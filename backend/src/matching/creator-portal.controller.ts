import { Controller, Post, Get, Param, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { OpportunityService } from './opportunity.service';
import { CreatorAuthGuard } from './creator-auth.guard';
import { CurrentUser } from '../common/decorators';

// E8 / ADR-0050 replaces this controller's former pilot-only login stub
// (a bare creator_id, no password, no verification) with real creator
// registration/verification/login, built in creator-network and reusing
// AuthService's exported createUser/verifyEmailToken/authenticateCredentials
// methods. The opportunity accept/decline endpoints below are untouched:
// both the old stub and the real login issue the identical creator JWT
// shape (sub = user_id, creator_id claim), which CreatorAuthGuard and
// JwtStrategy already handle unchanged.
@Controller('creator-portal')
export class CreatorPortalController {
  constructor(private opportunityService: OpportunityService) {}

  private actorContext(req: Request) {
    return { ipAddress: req.ip || '', userAgent: req.headers['user-agent'] || '' };
  }

  @UseGuards(CreatorAuthGuard)
  @Get('opportunities')
  @HttpCode(HttpStatus.OK)
  async list(@CurrentUser() user: any) {
    return this.opportunityService.listForCreator(user.creatorId);
  }

  @UseGuards(CreatorAuthGuard)
  @Post('opportunities/:id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.opportunityService.accept(id, user.creatorId, this.actorContext(req));
  }

  @UseGuards(CreatorAuthGuard)
  @Post('opportunities/:id/decline')
  @HttpCode(HttpStatus.OK)
  async decline(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.opportunityService.decline(id, user.creatorId, this.actorContext(req));
  }
}
