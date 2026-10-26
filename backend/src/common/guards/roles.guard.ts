import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../database/entities';
import { ROLES_KEY, IS_PUBLIC_KEY, CREATOR_PORTAL_ROUTE_KEY } from '../decorators';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessService } from '../account-access.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private auditService: AuditService,
    private accountAccessService: AccountAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // @Public() routes carry no request.user by the time this guard runs
    // (JwtAuthGuard skips Passport for them entirely); there is nothing for
    // this guard to resolve for them. Unchanged behavior, now explicit
    // instead of accidental (ADR-0064).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Creator-portal routes are not account-scoped at all: creators carry no
    // Membership row and no currentAccountId, by design, and their real
    // authorization is CreatorAuthGuard's job, applied at the same call
    // site. This is an explicit, route-level exemption, not an inference
    // from any property of the caller's token or headers -- see ADR-0064
    // for why checking user.isCreator or a falsy accountId instead of this
    // metadata does not close the authorization bypass this guard exists
    // to prevent.
    const isCreatorPortalRoute = this.reflector.getAllAndOverride<boolean>(
      CREATOR_PORTAL_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isCreatorPortalRoute) {
      return true;
    }

    const user = request.user;

    const accountId = request.headers['x-account-id'] || user?.currentAccountId;

    // Every other route is account-scoped: an authenticated user with no
    // resolvable account context here (no X-Account-Id header, no
    // currentAccountId claim) has no legitimate reason to be hitting this
    // route, and must be denied and logged, not waved through. This closes
    // the bypass where a creator-portal JWT (or any other caller with no
    // account context) reached a brand/agency-scoped route with no role
    // check and no audit trail.
    if (!accountId) {
      await this.auditService.log({
        actorUserId: user?.sub,
        targetAccountId: null,
        action: 'authorization.denied',
        metadata: {
          reason: 'no_account_context',
          endpoint: request.url,
          method: request.method,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new ForbiddenException({
        error: {
          code: 'INSUFFICIENT_PRIVILEGES',
          message: 'Voce nao tem permissao para realizar esta acao.',
          details: {},
        },
      });
    }

    // Every account-scoped route must resolve to a real relationship between
    // this user and the target account, regardless of whether it also
    // requires specific roles. A route with no @Roles() (e.g. a read-only
    // GET) still must not accept an arbitrary X-Account-Id from a user with
    // no relationship to it -- this used to be unchecked entirely, which let
    // any authenticated user read any other tenant's data by just sending
    // its account id. resolveAccess also covers the agency-acting-on-a-
    // client-account case, where no direct Membership row exists on the
    // client account itself.
    const resolvedRole = await this.accountAccessService.resolveAccess(
      user?.sub,
      user?.memberships || [],
      accountId,
    );

    if (!resolvedRole) {
      await this.auditService.log({
        actorUserId: user?.sub,
        targetAccountId: accountId,
        action: 'authorization.denied',
        metadata: {
          reason: 'no_account_relationship',
          endpoint: request.url,
          method: request.method,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new ForbiddenException({
        error: {
          code: 'INSUFFICIENT_PRIVILEGES',
          message: 'Voce nao tem permissao para realizar esta acao.',
          details: {},
        },
      });
    }

    request.currentAccountId = accountId;
    request.currentRole = resolvedRole;

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    if (!requiredRoles.includes(resolvedRole)) {
      await this.auditService.log({
        actorUserId: user?.sub,
        targetAccountId: accountId,
        action: 'authorization.denied',
        metadata: {
          required_roles: requiredRoles,
          user_role: resolvedRole,
          endpoint: request.url,
          method: request.method,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      throw new ForbiddenException({
        error: {
          code: 'INSUFFICIENT_PRIVILEGES',
          message: 'Voce nao tem permissao para realizar esta acao.',
          details: {},
        },
      });
    }

    return true;
  }
}
