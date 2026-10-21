import { Controller, Get, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

// FR-60, section 5.4 of the E9 architecture doc (shared addendum to US-38
// and US-45). X-Account-Id resolves the one client account whose log is
// being requested, identically to every other account-scoped GET in the
// platform -- RolesGuard has already refused the request (403, logged)
// for any caller with no resolvable relationship to that account by the
// time this handler runs. No agency/brand-workspace branch is needed:
// a brand-workspace user never holds agency_admin or agency_operator.
@Controller('audit-log')
@Roles(Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR)
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    return this.auditService.listForAccount(
      (req as any).currentAccountId,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
