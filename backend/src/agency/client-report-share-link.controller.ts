import {
  Controller,
  Post,
  Delete,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { ClientReportShareLinkService } from './client-report-share-link.service';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';

// US-44 / FR-57, section 5.5 of the E9 architecture doc. Caller's
// X-Account-Id is the client account itself, same convention as E7's
// AgencyClientReportController -- RolesGuard has already resolved whether
// this caller may act on clientAccountId by the time either handler runs.
@Controller('agency/clients/:clientAccountId/reports/:reportId/share-link')
@Roles(Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR)
export class ClientReportShareLinkController {
  constructor(
    private shareLinkService: ClientReportShareLinkService,
    private auditService?: AuditService,
  ) {}

  private actorContext(req: Request) {
    const user = (req as any).user;
    return {
      userId: user?.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  // NFR-16: RolesGuard/AccountAccessService.resolveAccess has already run
  // the same dual check this epic applies everywhere else a per-client path
  // parameter is involved (AgencyService.grantOperatorAccess/
  // revokeOperatorAccess, TemplateService.copyTemplate for US-41) -- an
  // agency_admin has implicit access to every client in their own
  // workspace, an agency_operator only to a client with an explicit
  // operator_client_access grant -- for whichever account the request's own
  // X-Account-Id header named, and set req.currentAccountId to that
  // already-authorized result. Neither handler below ever compared that
  // resolved account against the separate :clientAccountId path segment it
  // also receives, so a caller authorized for their OWN account could put a
  // different, unauthorized client's id in the path and still mint or
  // revoke a public share link for it. Refusing any mismatch here closes
  // that gap: req.currentAccountId already carries the full result of the
  // dual check above for whatever account it names, so comparing against it
  // is equivalent to re-running that check against clientAccountId directly.
  private async refuseAccountMismatch(clientAccountId: string, req: Request): Promise<never> {
    const actor = this.actorContext(req);
    await this.auditService?.log({
      actorUserId: actor.userId,
      targetAccountId: clientAccountId,
      action: 'authorization.denied',
      metadata: {
        reason: 'share_link_client_account_mismatch',
        resolved_account_id: (req as any).currentAccountId,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    throw new ForbiddenException({
      error: {
        code: 'CLIENT_NOT_ACCESSIBLE',
        message: 'Voce nao tem acesso a esta conta de cliente.',
        details: {},
      },
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async mint(
    @Param('clientAccountId') clientAccountId: string,
    @Param('reportId') reportId: string,
    @Req() req: Request,
  ) {
    const currentAccountId = (req as any).currentAccountId;
    if (currentAccountId && currentAccountId !== clientAccountId) {
      await this.refuseAccountMismatch(clientAccountId, req);
    }
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
    const currentAccountId = (req as any).currentAccountId;
    if (currentAccountId && currentAccountId !== clientAccountId) {
      await this.refuseAccountMismatch(clientAccountId, req);
    }
    await this.shareLinkService.revoke(clientAccountId, reportId, linkId, this.actorContext(req));
  }
}
