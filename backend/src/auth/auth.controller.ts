import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  VerifyEmailDto,
  ResendVerificationDto,
  RefreshDto,
  MfaConfirmDto,
} from './dto';
import { Public, CurrentUser } from '../common/decorators';
import { Request } from 'express';

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(
      dto,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    return this.authService.verifyEmail(
      dto.token,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  async mfaSetup(@CurrentUser('sub') userId: string) {
    return this.authService.mfaSetup(userId);
  }

  @Post('mfa/confirm')
  @HttpCode(HttpStatus.OK)
  async mfaConfirm(
    @Body() dto: MfaConfirmDto,
    @CurrentUser('sub') userId: string,
    @Req() req: Request,
  ) {
    return this.authService.mfaConfirm(
      userId,
      dto.code,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }
}
