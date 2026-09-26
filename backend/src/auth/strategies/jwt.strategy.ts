import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'fallback',
    });
  }

  async validate(payload: any) {
    return {
      sub: payload.sub,
      email: payload.email,
      memberships: payload.memberships || [],
      currentAccountId: payload.memberships?.[0]?.account_id,
    };
  }
}
