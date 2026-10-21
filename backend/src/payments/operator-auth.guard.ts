import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities';

// ADR-0038: the aurora_operator principal, analogous to CreatorAuthGuard's
// escape from account-based RBAC. is_aurora_operator is never granted
// through any API this epic exposes (set directly, outside this epic's API
// surface), so this guard re-reads the user row rather than trusting a JWT
// claim that could go stale between grant and token expiry.
//
// Section 3.5 / ADR-0038: MFA is mandatory, unconditionally, for this
// principal -- "can approve payouts" is exactly NFR-19's own naming of a
// role requiring it. Reuses E1's MFA_REQUIRED_FOR_ROLE error code.
@Injectable()
export class OperatorAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    if (!jwtUser?.sub) {
      throw new ForbiddenException({
        error: {
          code: 'OPERATOR_AUTH_REQUIRED',
          message: 'Este endpoint requer autenticacao de operador Aurora.',
          details: {},
        },
      });
    }

    const user = await this.userRepo.findOne({ where: { id: jwtUser.sub } });
    if (!user || !user.isAuroraOperator) {
      throw new ForbiddenException({
        error: {
          code: 'OPERATOR_AUTH_REQUIRED',
          message: 'Este endpoint requer autenticacao de operador Aurora.',
          details: {},
        },
      });
    }

    if (!user.mfaEnabled) {
      throw new ForbiddenException({
        error: {
          code: 'MFA_REQUIRED_FOR_ROLE',
          message: 'O operador precisa ativar a autenticacao multifator para realizar esta acao.',
          details: {},
        },
      });
    }

    request.auroraOperatorUserId = user.id;
    return true;
  }
}
