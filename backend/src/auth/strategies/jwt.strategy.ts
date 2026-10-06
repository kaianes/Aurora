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
    // Creator-portal tokens (US-28, E3) carry a creator_id claim and no
    // memberships: creators are not members of any account and hold no
    // RBAC role (section 2.3 of the E3 architecture doc).
    if (payload.creator_id) {
      return {
        sub: payload.sub,
        isCreator: true,
        creatorId: payload.creator_id,
        memberships: [],
      };
    }

    return {
      sub: payload.sub,
      email: payload.email,
      memberships: payload.memberships || [],
      currentAccountId: payload.memberships?.[0]?.account_id,
    };
  }
}
