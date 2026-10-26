import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  TaxDocument,
  TaxDocumentStatus,
  PayoutObligation,
  PayoutObligationStatus,
  Creator,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from './pg-errors';

// US-36b / FR-50 (ADR-0041, Brazil-only pilot scope). Generation is
// triggered by the generate-tax-document job on settlement (section 5 of
// the E6 architecture doc); generateForSettledObligation is idempotent
// (unique on payout_obligation_id), so a lazy call from the creator-facing
// read endpoint -- guarding against the job not having run yet -- never
// creates a second document for the same obligation.
@Injectable()
export class TaxDocumentService {
  constructor(
    @InjectRepository(TaxDocument)
    private taxDocumentRepo: Repository<TaxDocument>,
    @InjectRepository(PayoutObligation)
    private obligationRepo: Repository<PayoutObligation>,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    private auditService: AuditService,
    private configService: ConfigService,
  ) {}

  async generateForSettledObligation(obligationId: string): Promise<TaxDocument> {
    const existing = await this.taxDocumentRepo.findOne({
      where: { payoutObligationId: obligationId },
    });
    if (existing) {
      return existing;
    }

    const obligation = await this.obligationRepo.findOne({ where: { id: obligationId } });
    if (!obligation || obligation.status !== PayoutObligationStatus.SETTLED) {
      // Defensive only: this is called by the generate-tax-document job
      // (enqueued on settlement) and, as a lazy fallback, by the
      // tax-document read endpoint, which already checks settlement
      // itself. A still-unsettled obligation reaching here means a
      // malformed/synthetic call -- no document is ever generated for an
      // obligation that has not settled.
      throw new ConflictException({
        error: {
          code: 'PAYOUT_OBLIGATION_NOT_SETTLED',
          message: 'Documento fiscal so pode ser gerado apos a liquidacao do pagamento.',
          details: {},
        },
      });
    }

    const creator = await this.creatorRepo.findOne({ where: { id: obligation.creatorId } });
    const taxPeriod = this.formatTaxPeriod(obligation.settledAt as Date);

    const doc = creator?.taxId
      ? this.taxDocumentRepo.create({
          payoutObligationId: obligation.id,
          creatorId: obligation.creatorId,
          status: TaxDocumentStatus.GENERATED,
          missingFields: null,
          documentUrl: this.buildDocumentUrl(obligation.id),
          taxPeriod,
          generatedAt: new Date(),
        })
      : this.taxDocumentRepo.create({
          payoutObligationId: obligation.id,
          creatorId: obligation.creatorId,
          status: TaxDocumentStatus.BLOCKED_MISSING_INFO,
          missingFields: ['tax_id'],
          documentUrl: null,
          taxPeriod,
          generatedAt: null,
        });

    try {
      const saved = await this.taxDocumentRepo.save(doc);
      await this.auditService.log({
        actorUserId: null,
        targetAccountId: null,
        action:
          saved.status === TaxDocumentStatus.GENERATED
            ? 'tax_document.generated'
            : 'tax_document.blocked_missing_info',
        metadata: { payout_obligation_id: obligation.id, tax_document_id: saved.id },
      });
      return saved;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raceWinner = await this.taxDocumentRepo.findOne({
          where: { payoutObligationId: obligationId },
        });
        if (raceWinner) return raceWinner;
      }
      throw error;
    }
  }

  async getForCreator(obligationId: string, creatorId: string) {
    const obligation = await this.obligationRepo.findOne({
      where: { id: obligationId, creatorId },
    });
    if (!obligation) {
      throw new NotFoundException({
        error: {
          code: 'TAX_DOCUMENT_NOT_AVAILABLE',
          message: 'Documento fiscal nao disponivel para esta obrigacao.',
          details: {},
        },
      });
    }
    if (obligation.status !== PayoutObligationStatus.SETTLED) {
      throw new NotFoundException({
        error: {
          code: 'TAX_DOCUMENT_NOT_AVAILABLE',
          message: 'Documento fiscal nao disponivel: pagamento ainda nao foi liquidado.',
          details: {},
        },
      });
    }

    const doc = await this.generateForSettledObligation(obligationId);

    if (doc.status === TaxDocumentStatus.BLOCKED_MISSING_INFO) {
      return {
        status: doc.status,
        missing_fields: doc.missingFields,
        message:
          'Para gerar seu documento fiscal, e necessario informar seu CPF ou CNPJ no seu perfil.',
      };
    }

    return {
      status: doc.status,
      tax_period: doc.taxPeriod,
      document_url: doc.documentUrl,
      generated_at: doc.generatedAt?.toISOString() || null,
    };
  }

  private formatTaxPeriod(settledAt: Date): string {
    const year = settledAt.getUTCFullYear();
    const month = String(settledAt.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private buildDocumentUrl(obligationId: string): string {
    const s3Key = `tax-documents/${obligationId}/doc.pdf`;
    const baseUrl = this.configService.get('S3_PUBLIC_URL') || 'https://assets.aurora.com.br';
    return `${baseUrl}/${s3Key}`;
  }
}
