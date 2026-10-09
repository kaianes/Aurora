import {
  Controller,
  Get,
  Patch,
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
import { WorkspaceService } from './workspace.service';
import { ChangeRoleDto } from './dto/change-role.dto';
import { Roles, CurrentUser } from '../common/decorators';
import { Role } from '../database/entities';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class WorkspaceController {
  constructor(private workspaceService: WorkspaceService) {}

  @Get('workspaces/current')
  @HttpCode(HttpStatus.OK)
  async getCurrentWorkspace(
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const accountId =
      (req as any).currentAccountId ||
      req.headers['x-account-id'] ||
      user.currentAccountId;
    return this.workspaceService.getCurrentWorkspace(user.sub, accountId);
  }

  @Get('accounts/:id/members')
  @HttpCode(HttpStatus.OK)
  async listMembers(
    @Param('id') accountId: string,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
  ) {
    return this.workspaceService.listMembers(
      accountId,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Patch('accounts/:accountId/members/:userId')
  @Roles(Role.BRAND_OWNER, Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.OK)
  async changeRole(
    @Param('accountId') accountId: string,
    @Param('userId') userId: string,
    @Body() dto: ChangeRoleDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.workspaceService.changeRole(
      accountId,
      userId,
      dto.role,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Delete('accounts/:accountId/members/:userId')
  @Roles(Role.BRAND_OWNER, Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('accountId') accountId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    await this.workspaceService.removeMember(
      accountId,
      userId,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }
}
