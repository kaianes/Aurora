import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser, CreatorPortalRoute } from '../common/decorators';
import { OnboardingService } from './onboarding.service';
import { UpdateCreatorProfileDto } from './dto';

// US-24.4 (section 5.7 of the E8 architecture doc) and section 5, step 3
// (PATCH /creator-portal/profile).
@Controller('creator-portal')
@UseGuards(CreatorAuthGuard)
@CreatorPortalRoute()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  @Get('onboarding/status')
  @HttpCode(HttpStatus.OK)
  async getStatus(@CurrentUser() user: any) {
    return this.onboardingService.getStatus(user.creatorId);
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(@Body() dto: UpdateCreatorProfileDto, @CurrentUser() user: any) {
    return this.onboardingService.updateProfile(user.creatorId, dto);
  }
}
