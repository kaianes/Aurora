import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

// Creator-portal endpoints authenticate with a creator JWT (sub = user_id,
// creator_id claim), never a membership-bearing account JWT (section 2.3 of
// the E3 architecture doc). This guard rejects any token that is not a
// creator token, independent of the (global) RolesGuard, which only governs
// membership-based roles and would otherwise allow any authenticated user
// through since creator-portal routes carry no @Roles decorator.
@Injectable()
export class CreatorAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.isCreator || !user?.creatorId) {
      throw new ForbiddenException({
        error: {
          code: 'CREATOR_AUTH_REQUIRED',
          message: 'Este endpoint requer autenticacao de criador.',
          details: {},
        },
      });
    }
    return true;
  }
}
