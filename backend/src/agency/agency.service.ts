import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Account,
  Workspace,
  WorkspaceType,
  Membership,
  Role,
  OperatorClientAccess,
  BrandProfile,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { CreateClientDto } from './dto/create-client.dto';

@Injectable()
export class AgencyService {
  constructor(
    @InjectRepository(Account) private accountRepo: Repository<Account>,
    @InjectRepository(Workspace) private workspaceRepo: Repository<Workspace>,
    @InjectRepository(Membership) private membershipRepo: Repository<Membership>,
    @InjectRepository(OperatorClientAccess)
    private operatorAccessRepo: Repository<OperatorClientAccess>,
    @InjectRepository(BrandProfile)
    private brandProfileRepo: Repository<BrandProfile>,
    private auditService: AuditService,
  ) {}

  async createClient(
    currentAccountId: string,
    dto: CreateClientDto,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    // Get workspace from current account
    const currentAccount = await this.accountRepo.findOne({
      where: { id: currentAccountId },
      relations: { workspace: true },
    });
    if (!currentAccount) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Conta nao encontrada.', details: {} },
      });
    }

    const workspace = currentAccount.workspace;

    if (workspace.type !== WorkspaceType.AGENCY) {
      throw new BadRequestException({
        error: {
          code: 'NOT_AGENCY_WORKSPACE',
          message: 'Este endpoint esta disponivel apenas para workspaces de agencia.',
          details: {},
        },
      });
    }

    // Count client accounts (excluding home account)
    const allAccounts = await this.accountRepo.find({
      where: { workspaceId: workspace.id },
      order: { createdAt: 'ASC' },
    });
    // First account is the home account
    const clientCount = allAccounts.length - 1;

    if (clientCount >= workspace.maxClientAccounts) {
      throw new ForbiddenException({
        error: {
          code: 'CLIENT_LIMIT_REACHED',
          message: `O limite de contas de clientes foi atingido (${workspace.maxClientAccounts}). Entre em contato com o suporte para aumentar o limite.`,
          details: { current: clientCount, max: workspace.maxClientAccounts },
        },
      });
    }

    // Validate copy_templates_from if provided
    let templatesCopied = 0;
    if (dto.copy_templates_from) {
      const sourceAccount = await this.accountRepo.findOne({
        where: { id: dto.copy_templates_from, workspaceId: workspace.id },
      });
      if (!sourceAccount) {
        throw new BadRequestException({
          error: {
            code: 'INVALID_SOURCE_ACCOUNT',
            message: 'A conta de origem para copiar templates nao foi encontrada neste workspace.',
            details: {},
          },
        });
      }
      // Template copying would happen here in future epics
      // For E1, we acknowledge the parameter but no campaign templates exist yet
      templatesCopied = 0;
    }

    // Create the client account
    const clientAccount = this.accountRepo.create({
      workspaceId: workspace.id,
      name: dto.name,
    });
    const saved = await this.accountRepo.save(clientAccount);

    await this.auditService.log({
      actorUserId,
      targetAccountId: saved.id,
      action: 'client_account.created',
      metadata: {
        workspace_id: workspace.id,
        client_name: dto.name,
        copy_templates_from: dto.copy_templates_from || null,
        templates_copied: templatesCopied,
      },
      ipAddress,
      userAgent,
    });

    return {
      id: saved.id,
      workspace_id: workspace.id,
      name: saved.name,
      status: saved.status,
      templates_copied: templatesCopied,
      created_at: saved.createdAt.toISOString(),
    };
  }

  async listClients(
    currentAccountId: string,
    userId: string,
    currentRole: string,
    cursor?: string,
    limit: number = 20,
  ) {
    const currentAccount = await this.accountRepo.findOne({
      where: { id: currentAccountId },
      relations: { workspace: true },
    });
    if (!currentAccount) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Conta nao encontrada.', details: {} },
      });
    }

    const workspace = currentAccount.workspace;
    const allAccounts = await this.accountRepo.find({
      where: { workspaceId: workspace.id },
      order: { createdAt: 'ASC' },
    });

    const homeAccountId = allAccounts[0]?.id;
    let clientAccounts = allAccounts.filter((a) => a.id !== homeAccountId);

    // If operator, filter to accessible accounts only
    if (currentRole === Role.AGENCY_OPERATOR) {
      const membership = await this.membershipRepo.findOne({
        where: { userId, accountId: currentAccountId },
      });
      if (membership) {
        const accesses = await this.operatorAccessRepo.find({
          where: { membershipId: membership.id },
        });
        const accessibleIds = new Set(accesses.map((a) => a.accountId));
        clientAccounts = clientAccounts.filter((a) =>
          accessibleIds.has(a.id),
        );
      }
    }

    // Get brand profile status for each client
    const data = await Promise.all(
      clientAccounts.map(async (account) => {
        const bp = await this.brandProfileRepo.findOne({
          where: { accountId: account.id },
        });
        return {
          id: account.id,
          name: account.name,
          status: account.status,
          brand_profile_status: bp?.status || null,
          created_at: account.createdAt.toISOString(),
        };
      }),
    );

    return {
      data,
      pagination: {
        next_cursor: null,
        has_more: false,
      },
      limits: {
        used: clientAccounts.length,
        max: workspace.maxClientAccounts,
      },
    };
  }

  async grantOperatorAccess(
    clientAccountId: string,
    targetUserId: string,
    currentAccountId: string,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    // Verify target user is an agency_operator in this workspace
    const currentAccount = await this.accountRepo.findOne({
      where: { id: currentAccountId },
      relations: { workspace: true },
    });
    if (!currentAccount) throw new NotFoundException();

    // Find the operator's membership in the workspace (home account)
    const allAccounts = await this.accountRepo.find({
      where: { workspaceId: currentAccount.workspace.id },
      order: { createdAt: 'ASC' },
    });
    const homeAccountId = allAccounts[0]?.id;

    const operatorMembership = await this.membershipRepo.findOne({
      where: {
        userId: targetUserId,
        accountId: homeAccountId,
        role: Role.AGENCY_OPERATOR,
      },
    });

    if (!operatorMembership) {
      throw new BadRequestException({
        error: {
          code: 'NOT_AN_OPERATOR',
          message:
            'O usuario nao e um operador neste workspace.',
          details: {},
        },
      });
    }

    // Verify client account belongs to same workspace
    const clientAccount = await this.accountRepo.findOne({
      where: { id: clientAccountId, workspaceId: currentAccount.workspace.id },
    });
    if (!clientAccount) {
      throw new NotFoundException({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: 'Conta de cliente nao encontrada neste workspace.',
          details: {},
        },
      });
    }

    const access = this.operatorAccessRepo.create({
      membershipId: operatorMembership.id,
      accountId: clientAccountId,
    });
    const saved = await this.operatorAccessRepo.save(access);

    await this.auditService.log({
      actorUserId,
      targetAccountId: clientAccountId,
      action: 'operator_access.granted',
      metadata: {
        operator_user_id: targetUserId,
        membership_id: operatorMembership.id,
      },
      ipAddress,
      userAgent,
    });

    return {
      membership_id: operatorMembership.id,
      account_id: clientAccountId,
      granted_at: saved.createdAt.toISOString(),
    };
  }

  async revokeOperatorAccess(
    clientAccountId: string,
    targetUserId: string,
    currentAccountId: string,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const currentAccount = await this.accountRepo.findOne({
      where: { id: currentAccountId },
      relations: { workspace: true },
    });
    if (!currentAccount) throw new NotFoundException();

    const allAccounts = await this.accountRepo.find({
      where: { workspaceId: currentAccount.workspace.id },
      order: { createdAt: 'ASC' },
    });
    const homeAccountId = allAccounts[0]?.id;

    const operatorMembership = await this.membershipRepo.findOne({
      where: {
        userId: targetUserId,
        accountId: homeAccountId,
        role: Role.AGENCY_OPERATOR,
      },
    });

    if (!operatorMembership) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'Operador nao encontrado.',
          details: {},
        },
      });
    }

    const access = await this.operatorAccessRepo.findOne({
      where: {
        membershipId: operatorMembership.id,
        accountId: clientAccountId,
      },
    });

    if (!access) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'Acesso nao encontrado.',
          details: {},
        },
      });
    }

    await this.operatorAccessRepo.remove(access);

    await this.auditService.log({
      actorUserId,
      targetAccountId: clientAccountId,
      action: 'operator_access.revoked',
      metadata: {
        operator_user_id: targetUserId,
        membership_id: operatorMembership.id,
      },
      ipAddress,
      userAgent,
    });
  }
}
