import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Workspace,
  Account,
  Membership,
  Role,
  OperatorClientAccess,
  User,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(Workspace) private workspaceRepo: Repository<Workspace>,
    @InjectRepository(Account) private accountRepo: Repository<Account>,
    @InjectRepository(Membership) private membershipRepo: Repository<Membership>,
    @InjectRepository(OperatorClientAccess)
    private operatorAccessRepo: Repository<OperatorClientAccess>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private auditService: AuditService,
  ) {}

  async getCurrentWorkspace(userId: string, currentAccountId: string) {
    const membership = await this.membershipRepo.findOne({
      where: { userId, accountId: currentAccountId },
      relations: { account: { workspace: true } },
    });

    if (!membership) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'Workspace nao encontrado.',
          details: {},
        },
      });
    }

    const workspace = membership.account.workspace;

    // Get all accounts the user has access to
    let accounts: Account[];
    if (membership.role === Role.AGENCY_ADMIN) {
      accounts = await this.accountRepo.find({
        where: { workspaceId: workspace.id },
      });
    } else if (membership.role === Role.AGENCY_OPERATOR) {
      const accesses = await this.operatorAccessRepo.find({
        where: { membershipId: membership.id },
        relations: { account: true },
      });
      const homeAccount = await this.accountRepo.findOne({
        where: { id: currentAccountId },
      });
      accounts = [
        ...(homeAccount ? [homeAccount] : []),
        ...accesses.map((a) => a.account),
      ];
    } else {
      accounts = [membership.account];
    }

    // Determine home account (first account created for workspace)
    const allWsAccounts = await this.accountRepo.find({
      where: { workspaceId: workspace.id },
      order: { createdAt: 'ASC' },
    });
    const homeAccountId = allWsAccounts[0]?.id;

    return {
      workspace: {
        id: workspace.id,
        type: workspace.type,
        name: workspace.name,
        max_client_accounts: workspace.maxClientAccounts,
        created_at: workspace.createdAt.toISOString(),
      },
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        is_home: a.id === homeAccountId,
      })),
      current_account: {
        id: currentAccountId,
        role: membership.role,
      },
    };
  }

  async listMembers(
    accountId: string,
    cursor?: string,
    limit: number = 20,
  ) {
    const qb = this.membershipRepo
      .createQueryBuilder('membership')
      .leftJoinAndSelect('membership.user', 'user')
      .where('membership.account_id = :accountId', { accountId })
      .orderBy('membership.created_at', 'ASC')
      .take(Math.min(limit, 100));

    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      qb.andWhere('membership.created_at > :cursor', { cursor: decoded });
    }

    const memberships = await qb.getMany();
    const hasMore = memberships.length === Math.min(limit, 100);
    const nextCursor =
      hasMore && memberships.length > 0
        ? Buffer.from(
            memberships[memberships.length - 1].createdAt.toISOString(),
          ).toString('base64')
        : null;

    return {
      data: memberships.map((m) => ({
        user_id: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        joined_at: m.createdAt.toISOString(),
      })),
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    };
  }

  async changeRole(
    accountId: string,
    targetUserId: string,
    newRole: string,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const membership = await this.membershipRepo.findOne({
      where: { userId: targetUserId, accountId },
    });
    if (!membership) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'Membro nao encontrado.',
          details: {},
        },
      });
    }

    // Validate: cannot remove last owner/admin
    const ownerRoles = [Role.BRAND_OWNER, Role.AGENCY_ADMIN];
    if (ownerRoles.includes(membership.role as Role)) {
      const ownerCount = await this.membershipRepo.count({
        where: { accountId, role: membership.role as Role },
      });
      if (ownerCount <= 1 && newRole !== membership.role) {
        throw new BadRequestException({
          error: {
            code: 'CANNOT_REMOVE_LAST_OWNER',
            message:
              'Nao e possivel alterar o papel do ultimo proprietario/administrador.',
            details: {},
          },
        });
      }
    }

    // Check MFA requirement for financial roles (future-proofing)
    // At E1 scope, no roles require MFA, but the check is built in.
    const financialRoles: string[] = []; // Will be populated in E6
    if (financialRoles.includes(newRole)) {
      const user = await this.userRepo.findOne({
        where: { id: targetUserId },
      });
      if (user && !user.mfaEnabled) {
        throw new BadRequestException({
          error: {
            code: 'MFA_REQUIRED_FOR_ROLE',
            message:
              'O usuario precisa ativar MFA antes de receber este papel.',
            details: {},
          },
        });
      }
    }

    const oldRole = membership.role;
    membership.role = newRole as Role;
    await this.membershipRepo.save(membership);

    await this.auditService.log({
      actorUserId,
      targetAccountId: accountId,
      action: 'membership.role_changed',
      metadata: {
        target_user_id: targetUserId,
        old_role: oldRole,
        new_role: newRole,
      },
      ipAddress,
      userAgent,
    });

    return {
      user_id: targetUserId,
      role: newRole,
      updated_at: new Date().toISOString(),
    };
  }

  async removeMember(
    accountId: string,
    targetUserId: string,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const membership = await this.membershipRepo.findOne({
      where: { userId: targetUserId, accountId },
    });
    if (!membership) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'Membro nao encontrado.',
          details: {},
        },
      });
    }

    // Cannot remove last owner/admin
    const ownerRoles = [Role.BRAND_OWNER, Role.AGENCY_ADMIN];
    if (ownerRoles.includes(membership.role as Role)) {
      const ownerCount = await this.membershipRepo.count({
        where: { accountId, role: membership.role as Role },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException({
          error: {
            code: 'CANNOT_REMOVE_LAST_OWNER',
            message:
              'Nao e possivel remover o ultimo proprietario/administrador.',
            details: {},
          },
        });
      }
    }

    await this.membershipRepo.remove(membership);

    await this.auditService.log({
      actorUserId,
      targetAccountId: accountId,
      action: 'membership.removed',
      metadata: {
        target_user_id: targetUserId,
        role: membership.role,
      },
      ipAddress,
      userAgent,
    });
  }
}
