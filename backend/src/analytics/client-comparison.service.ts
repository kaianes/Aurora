import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Account,
  Campaign,
  CampaignPerformanceAggregate,
  Invoice,
  Membership,
  OperatorClientAccess,
  Role,
} from '../database/entities';

export interface RefusedClient {
  client_account_id: string;
  reason: 'NOT_ACCESSIBLE';
}

// US-46 / FR-56, section 5.6 of the E7 architecture document (ADR-0048).
// No new entity is needed: a read across several already-isolated
// account_ids within one already-modeled workspace_id, respecting
// operator_client_access grants. The service layer is the actual scope
// limiter (section 2.5); the RLS escape hatch this epic adds is the
// backstop against a workspace boundary, not a replacement for this check.
@Injectable()
export class ClientComparisonService {
  constructor(
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    @InjectRepository(Membership)
    private membershipRepo: Repository<Membership>,
    @InjectRepository(OperatorClientAccess)
    private operatorAccessRepo: Repository<OperatorClientAccess>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignPerformanceAggregate)
    private aggregateRepo: Repository<CampaignPerformanceAggregate>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
  ) {}

  async compareClients(
    callerAccountId: string,
    userId: string,
    currentRole: Role,
    clientAccountIds: string[],
  ) {
    const callerAccount = await this.accountRepo.findOne({ where: { id: callerAccountId } });
    if (!callerAccount) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Conta nao encontrada.', details: {} },
      });
    }

    let operatorAccessibleIds: Set<string> | null = null;
    if (currentRole === Role.AGENCY_OPERATOR) {
      const membership = await this.membershipRepo.findOne({
        where: { userId, accountId: callerAccountId },
      });
      const accesses = membership
        ? await this.operatorAccessRepo.find({ where: { membershipId: membership.id } })
        : [];
      operatorAccessibleIds = new Set(accesses.map((a) => a.accountId));
    }

    const data: Array<Record<string, any>> = [];
    const refused: RefusedClient[] = [];

    for (const clientAccountId of clientAccountIds) {
      const clientAccount = await this.accountRepo.findOne({ where: { id: clientAccountId } });

      // 1. Validate it belongs to the caller's own workspace, and (if the
      // caller is agency_operator) that operator_client_access grants them
      // that specific client. A failing id is placed in refused with an
      // explicit reason -- never silently omitted (US-46 scenario 3).
      const inWorkspace = !!clientAccount && clientAccount.workspaceId === callerAccount.workspaceId;
      const operatorAllowed =
        !operatorAccessibleIds || operatorAccessibleIds.has(clientAccountId);

      if (!inWorkspace || !operatorAllowed) {
        refused.push({ client_account_id: clientAccountId, reason: 'NOT_ACCESSIBLE' });
        continue;
      }

      const campaigns = await this.campaignRepo.find({ where: { accountId: clientAccountId } });

      let totalSpend = 0;
      let totalReach = 0n;
      let totalEngagement = 0n;

      for (const campaign of campaigns) {
        const invoice = await this.invoiceRepo.findOne({ where: { campaignId: campaign.id } });
        totalSpend += invoice
          ? parseFloat(invoice.totalAmount)
          : parseFloat(campaign.lockedPrice || '0');

        const aggregate = await this.aggregateRepo.findOne({ where: { campaignId: campaign.id } });
        if (aggregate) {
          totalReach += BigInt(aggregate.totalDeliveredReach);
          totalEngagement += BigInt(aggregate.totalDeliveredEngagement);
        }
      }

      const campaignCount = campaigns.length;

      // 3. Present both a total and a per-campaign average for each client
      // (US-46 scenario 2) -- never a normalized figure implying a false
      // equivalence between a client with one campaign and a client with
      // many.
      data.push({
        client_account_id: clientAccountId,
        client_name: clientAccount!.name,
        campaign_count: campaignCount,
        total_spend: totalSpend.toFixed(2),
        total_delivered_reach: Number(totalReach),
        total_delivered_engagement: Number(totalEngagement),
        average_reach_per_campaign:
          campaignCount > 0 ? Math.round(Number(totalReach) / campaignCount) : 0,
        average_engagement_per_campaign:
          campaignCount > 0 ? Math.round(Number(totalEngagement) / campaignCount) : 0,
      });
    }

    // An all-refused response is a 400, not a 200 with an empty data array
    // (section 5.6).
    if (data.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'NO_VALID_CLIENTS',
          message: 'Nenhum dos clientes informados e valido ou acessivel.',
          details: { refused },
        },
      });
    }

    return { data, refused };
  }
}
