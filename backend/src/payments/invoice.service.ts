import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Invoice,
  InvoiceLineItem,
  InvoiceLineItemType,
  Campaign,
  CampaignState,
  CampaignOpportunity,
  OpportunityStatus,
  PoolShortfallResolution,
  ShortfallResolutionType,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from './pg-errors';

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

const BILLABLE_STATES = [CampaignState.ACTIVE, CampaignState.PAUSED, CampaignState.COMPLETED];

// US-20 / US-42, FR-48 / FR-49 (ADR-0039, ADR-0040). One shared schema for
// both a direct brand buyer and an agency client -- the campaign's own
// account_id already resolves which this is (ADR-0040); this service does
// not branch on buyer type at all.
@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem)
    private lineItemRepo: Repository<InvoiceLineItem>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(PoolShortfallResolution)
    private shortfallRepo: Repository<PoolShortfallResolution>,
    private auditService: AuditService,
  ) {}

  async generate(campaignId: string, accountId: string, actor: ActorContext) {
    const campaign = await this.findCampaignOrFail(campaignId, accountId);

    if (!BILLABLE_STATES.includes(campaign.state)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'CAMPAIGN_NOT_BILLABLE',
          message:
            'A campanha ainda nao atingiu um estado faturavel. Aguarde a confirmacao da campanha.',
          details: { state: campaign.state },
        },
      });
    }

    const pendingCount = await this.opportunityRepo.count({
      where: { campaignId, status: OpportunityStatus.PENDING },
    });
    if (pendingCount > 0) {
      throw new UnprocessableEntityException({
        error: {
          code: 'CAMPAIGN_NOT_BILLABLE',
          message:
            'A campanha ainda tem oportunidades pendentes de resposta. Aguarde a resolucao antes de gerar a fatura.',
          details: { pending_opportunities: pendingCount },
        },
      });
    }

    const existing = await this.invoiceRepo.findOne({ where: { campaignId } });
    if (existing) {
      throw new ConflictException({
        error: {
          code: 'INVOICE_ALREADY_GENERATED',
          message: 'Uma fatura ja foi gerada para esta campanha.',
          details: {},
        },
      });
    }

    const lockedPrice = campaign.lockedPrice || '0';
    const lineItems: Array<{ lineType: InvoiceLineItemType; description: string; amount: string }> = [
      {
        lineType: InvoiceLineItemType.BASE_PRICE,
        description: 'Preco fixo da campanha (FR-18)',
        amount: lockedPrice,
      },
    ];

    // ADR-0039: a partial_refund resolution gets exactly one itemized
    // adjustment line; revised_guarantee (and FR-23 reallocation) produces
    // none, since neither ever changes locked_price.
    const shortfall = await this.shortfallRepo.findOne({ where: { campaignId } });
    if (
      shortfall &&
      shortfall.resolutionType === ShortfallResolutionType.PARTIAL_REFUND &&
      shortfall.resolvedAt
    ) {
      const refundAmount = shortfall.refundAmount || '0';
      lineItems.push({
        lineType: InvoiceLineItemType.SHORTFALL_REFUND_ADJUSTMENT,
        description: 'Reembolso proporcional por pool abaixo do minimo garantido (FR-19)',
        amount: `-${refundAmount}`,
      });
    }

    const totalAmount = lineItems
      .reduce((sum, item) => sum + parseFloat(item.amount), 0)
      .toFixed(2);

    const invoice = this.invoiceRepo.create({
      campaignId,
      totalAmount,
      generatedByUserId: actor.userId,
      issuedAt: new Date(),
    });

    let saved: Invoice;
    try {
      saved = await this.invoiceRepo.save(invoice);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          error: {
            code: 'INVOICE_ALREADY_GENERATED',
            message: 'Uma fatura ja foi gerada para esta campanha.',
            details: {},
          },
        });
      }
      throw error;
    }

    const savedLineItems = await this.lineItemRepo.save(
      lineItems.map((item) =>
        this.lineItemRepo.create({
          invoiceId: saved.id,
          lineType: item.lineType,
          description: item.description,
          amount: item.amount,
        }),
      ),
    );

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'invoice.generated',
      metadata: { invoice_id: saved.id, campaign_id: campaignId, total_amount: totalAmount },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.format(saved, savedLineItems);
  }

  async getForCampaign(campaignId: string, accountId: string) {
    await this.findCampaignOrFail(campaignId, accountId);

    const invoice = await this.invoiceRepo.findOne({ where: { campaignId } });
    if (!invoice) {
      throw new NotFoundException({
        error: {
          code: 'INVOICE_NOT_YET_GENERATED',
          message: 'Nenhuma fatura foi gerada para esta campanha ainda.',
          details: {},
        },
      });
    }

    const lineItems = await this.lineItemRepo.find({ where: { invoiceId: invoice.id } });
    return this.format(invoice, lineItems);
  }

  private async findCampaignOrFail(id: string, accountId: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }
    return campaign;
  }

  private format(invoice: Invoice, lineItems: InvoiceLineItem[]) {
    return {
      id: invoice.id,
      campaign_id: invoice.campaignId,
      total_amount: invoice.totalAmount,
      line_items: lineItems.map((item) => ({
        line_type: item.lineType,
        description: item.description,
        amount: item.amount,
      })),
      issued_at: invoice.issuedAt.toISOString(),
    };
  }
}
