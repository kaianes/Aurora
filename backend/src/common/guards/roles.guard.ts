import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../database/entities';
import { ROLES_KEY } from '../decorators';
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
    const user = request.user;

    const accountId = request.headers['x-account-id'] || user?.currentAccountId;

    // Routes with no account context at all (creator-portal: creators carry
    // no memberships and send no X-Account-Id) skip account resolution
    // entirely -- there is nothing to check here, access for those routes is
    // enforced by CreatorAuthGuard instead.
    if (!accountId) {
      return true;
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
