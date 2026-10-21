import {
  Controller,
  Post,
  Delete,
  Param,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { ClientReportShareLinkService } from './client-report-share-link.service';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

// US-44 / FR-57, section 5.5 of the E9 architecture doc. Caller's
// X-Account-Id is the client account itself, same convention as E7's
// AgencyClientReportController -- RolesGuard has already resolved whether
// this caller may act on clientAccountId by the time either handler runs.
@Controller('agency/clients/:clientAccountId/reports/:reportId/share-link')
@Roles(Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR)
export class ClientReportShareLinkController {
  constructor(private shareLinkService: ClientReportShareLinkService) {}

  private actorContext(req: Request) {
    const user = (req as any).user;
    return {
      userId: user?.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async mint(
    @Param('clientAccountId') clientAccountId: string,
    @Param('reportId') reportId: string,
    @Req() req: Request,
  ) {
    return this.shareLinkService.mint(clientAccountId, reportId, this.actorContext(req));
  }

  @Delete(':linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('clientAccountId') clientAccountId: string,
    @Param('reportId') reportId: string,
    @Param('linkId') linkId: string,
    @Req() req: Request,
  ) {
    await this.shareLinkService.revoke(clientAccountId, reportId, linkId, this.actorContext(req));
  }
}
