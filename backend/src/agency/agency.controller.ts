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
import { AgencyService } from './agency.service';
import { CreateClientDto } from './dto/create-client.dto';
import { GrantOperatorDto } from './dto/grant-operator.dto';
import { Roles, CurrentUser } from '../common/decorators';
import { Role } from '../database/entities';

@Controller('agency')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AgencyController {
  constructor(private agencyService: AgencyService) {}

  @Post('clients')
  @Roles(Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createClient(
    @Body() dto: CreateClientDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.agencyService.createClient(
      (req as any).currentAccountId,
      dto,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Get('clients')
  @Roles(Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR)
  @HttpCode(HttpStatus.OK)
  async listClients(
    @CurrentUser() user: any,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    return this.agencyService.listClients(
      (req as any).currentAccountId,
      user.sub,
      (req as any).currentRole,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('clients/:clientId/operators')
  @Roles(Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async grantOperator(
    @Param('clientId') clientId: string,
    @Body() dto: GrantOperatorDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.agencyService.grantOperatorAccess(
      clientId,
      dto.user_id,
      (req as any).currentAccountId,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Delete('clients/:clientId/operators/:userId')
  @Roles(Role.AGENCY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOperator(
    @Param('clientId') clientId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    await this.agencyService.revokeOperatorAccess(
      clientId,
      userId,
      (req as any).currentAccountId,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }
}
