import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { CreatorRegistrationService } from './creator-registration.service';
import { RegisterCreatorDto } from './dto';
import { VerifyEmailDto, LoginDto } from '../auth/dto';
import { Public } from '../common/decorators';

// US-24.1 / ADR-0050 (section 5.1-5.2 of the E8 architecture doc). Replaces
// creator-portal.controller.ts's former pilot-only login stub.
@Controller('creator-portal')
@Public()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CreatorRegistrationController {
  constructor(private creatorRegistrationService: CreatorRegistrationService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterCreatorDto) {
    return this.creatorRegistrationService.register(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.creatorRegistrationService.verifyEmail(dto.token);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.creatorRegistrationService.login(dto);
  }
}
