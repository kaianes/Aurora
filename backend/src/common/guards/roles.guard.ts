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

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !user.memberships) {
      throw new ForbiddenException({
        error: {
          code: 'INSUFFICIENT_PRIVILEGES',
          message: 'Voce nao tem permissao para realizar esta acao.',
          details: {},
        },
      });
    }

    const accountId = request.headers['x-account-id'] || user.currentAccountId;
    const membership = user.memberships.find(
      (m: any) => m.account_id === accountId,
    );

    if (!membership || !requiredRoles.includes(membership.role)) {
      await this.auditService.log({
        actorUserId: user.sub,
        targetAccountId: accountId || null,
        action: 'authorization.denied',
        metadata: {
          required_roles: requiredRoles,
          user_role: membership?.role || null,
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
    request.currentRole = membership.role;
    return true;
  }
}
