import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { InvitationService } from './invitation.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { Roles, CurrentUser, Public } from '../common/decorators';
import { Role } from '../database/entities';

@Controller('invitations')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class InvitationController {
  constructor(private invitationService: InvitationService) {}

  @Post()
  @Roles(Role.BRAND_OWNER, Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    // Determine workspace type from user's membership
    const membership = user.memberships.find(
      (m: any) => m.account_id === (req as any).currentAccountId,
    );
    const workspaceType =
      membership?.role === Role.BRAND_OWNER ? 'brand' : 'agency';

    return this.invitationService.create(
      (req as any).currentAccountId,
      workspaceType,
      dto,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Post(':id/resend')
  @Roles(Role.BRAND_OWNER, Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.OK)
  async resend(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.invitationService.resend(
      id,
      (req as any).currentAccountId,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Get()
  @Roles(Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('status') status: string,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    return this.invitationService.list(
      (req as any).currentAccountId,
      status,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Body() dto: AcceptInvitationDto, @Req() req: Request) {
    // Try to extract authenticated user if present
    let authenticatedUserId: string | null = null;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const user = (req as any).user;
        if (user?.sub) {
          authenticatedUserId = user.sub;
        }
      }
    } catch {
      // Not authenticated, that's fine
    }

    return this.invitationService.accept(
      dto,
      authenticatedUserId,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Delete(':id')
  @Roles(Role.BRAND_OWNER, Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    await this.invitationService.cancel(
      id,
      (req as any).currentAccountId,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }
}
