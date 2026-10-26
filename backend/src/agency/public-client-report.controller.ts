import { Controller, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ClientReportShareLinkService } from './client-report-share-link.service';
import { Public } from '../common/decorators';

// US-44 / FR-57, section 5.5 of the E9 architecture doc (ADR-0061). The
// only route in this entire epic reachable by someone who has never had an
// Aurora account: no authentication, no X-Account-Id. Gated entirely by
// possession of the share link's own cryptographically random token, the
// same bearer-token-as-capability pattern E1's invitation.token and E8's
// creator-portal invitation already use.
@Controller('public/client-reports')
@Public()
export class PublicClientReportController {
  constructor(private shareLinkService: ClientReportShareLinkService) {}

  @Get(':token')
  @HttpCode(HttpStatus.OK)
  async getByToken(@Param('token') token: string) {
    return this.shareLinkService.getPublicView(token);
  }
}
