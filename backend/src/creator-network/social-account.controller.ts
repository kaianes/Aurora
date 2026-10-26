import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser, Public, CreatorPortalRoute } from '../common/decorators';
import { SocialAccountService } from './social-account.service';

// US-24.1 (sections 5.3-5.6 of the E8 architecture doc).
@Controller('creator-portal/social-accounts')
export class SocialAccountController {
  constructor(private socialAccountService: SocialAccountService) {}

  @UseGuards(CreatorAuthGuard)
  @CreatorPortalRoute()
  @Post(':platform/authorize')
  @HttpCode(HttpStatus.OK)
  async authorize(@Param('platform') platform: string, @CurrentUser() user: any) {
    return this.socialAccountService.authorize(user.creatorId, platform);
  }

  // Public: the platform redirects the browser without Aurora's bearer
  // token attached; identity is resolved from the server-bound state, never
  // from a caller-supplied creator_id (section 5.4).
  @Public()
  @Get(':platform/callback')
  @HttpCode(HttpStatus.FOUND)
  async callback(
    @Param('platform') platform: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const redirectTo = await this.socialAccountService.handleCallback(platform, {
      code,
      state,
      error,
    });
    return res.redirect(redirectTo);
  }

  @UseGuards(CreatorAuthGuard)
  @CreatorPortalRoute()
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@CurrentUser() user: any) {
    return this.socialAccountService.list(user.creatorId);
  }

  @UseGuards(CreatorAuthGuard)
  @CreatorPortalRoute()
  @Delete(':platform')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@Param('platform') platform: string, @CurrentUser() user: any) {
    await this.socialAccountService.disconnect(user.creatorId, platform);
  }
}
