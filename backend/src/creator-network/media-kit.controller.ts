import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser } from '../common/decorators';
import { MediaKitService } from './media-kit.service';

// US-25 (section 6 of the E8 architecture doc).
@Controller('creator-portal/media-kit')
@UseGuards(CreatorAuthGuard)
export class MediaKitController {
  constructor(private mediaKitService: MediaKitService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestExport(@CurrentUser() user: any) {
    return this.mediaKitService.requestExport(user.creatorId);
  }

  @Get(':exportId')
  @HttpCode(HttpStatus.OK)
  async getExport(@Param('exportId') exportId: string, @CurrentUser() user: any) {
    return this.mediaKitService.getExport(user.creatorId, exportId);
  }
}
