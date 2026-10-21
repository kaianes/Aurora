import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ContentSubmission, ContentReviewDecision, ContentReviewDecisionValue } from '../database/entities';
import { BrandSafetyGateService } from '../brand-safety/brand-safety-gate.service';
import { AuditService } from '../audit/audit.service';
import { ConfirmPublicationDto } from './dto/confirm-publication.dto';
import {
  PUBLICATION_LINK_VERIFIER_ADAPTER,
  PublicationLinkVerifierAdapter,
} from './adapters/publication-link-verifier.adapter';
import { PayoutObligationService } from '../payments/payout-obligation.service';

interface ActorContext {
  ipAddress: string;
  userAgent: string;
}

// US-34 / FR-42, the completion hook named explicitly by the E4 architecture
// document (section 3.6) and resolved here per ADR-0027: two independent
// gates (Marina's creative decision, and BrandSafetyGateService's own
// safety gate), checked in sequence, each with its own distinct error code,
// followed by ADR-0031's dedicated link-verification adapter.
@Injectable()
export class PublicationService {
  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(ContentReviewDecision)
    private decisionRepo: Repository<ContentReviewDecision>,
    private gateService: BrandSafetyGateService,
    @Inject(PUBLICATION_LINK_VERIFIER_ADAPTER)
    private linkVerifier: PublicationLinkVerifierAdapter,
    private auditService: AuditService,
    private payoutObligationService: PayoutObligationService,
    private dataSource: DataSource,
  ) {}

  async confirmPublication(submissionId: string, creatorId: string, dto: ConfirmPublicationDto, actor: ActorContext) {
    const submission = await this.submissionRepo.findOne({ where: { id: submissionId, creatorId } });
    if (!submission) {
      throw new NotFoundException({
        error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
      });
    }

    // Gate 1: Marina's creative decision (ADR-0026/ADR-0027). Independent of
    // the safety gate below -- neither table references the other.
    const decision = await this.decisionRepo.findOne({ where: { contentSubmissionId: submissionId } });
    if (!decision || decision.decision !== ContentReviewDecisionValue.APPROVED) {
      throw new ConflictException({
        error: {
          code: 'DRAFT_NOT_APPROVED',
          message: 'Este rascunho ainda nao foi aprovado pela marca.',
          details: {},
        },
      });
    }

    // Gate 2: the brand-safety gate, read through BrandSafetyGateService,
    // never reimplemented (section 3.6 of the E4 architecture doc).
    const gate = await this.gateService.getGateStatus(submissionId);
    if (!gate.cleared) {
      throw new ConflictException({
        error: {
          code: 'SAFETY_NOT_CLEARED',
          message: 'O conteudo ainda nao passou pela verificacao de seguranca da marca.',
          details: { blocking_reason: gate.blockingReason },
        },
      });
    }

    // ADR-0031: the dedicated publication-link-verification adapter, never
    // E4's lightweight monitoring fetcher.
    const verification = await this.linkVerifier.verify({
      publishedUrl: dto.published_url,
      approvedCaptionText: submission.captionText,
    });

    if (!verification.resolved) {
      throw new UnprocessableEntityException({
        error: {
          code: 'PUBLICATION_LINK_UNREACHABLE',
          message: 'O link informado nao pode ser acessado. Verifique o link e tente novamente.',
          details: {},
        },
      });
    }

    if (!verification.matches) {
      throw new UnprocessableEntityException({
        error: {
          code: 'PUBLICATION_CONTENT_MISMATCH',
          message: 'O conteudo publicado nao corresponde ao conteudo aprovado.',
          details: {
            field: 'caption_text',
            approved: submission.captionText,
            fetched: verification.fetchedCaptionText,
          },
        },
      });
    }

    submission.publishedUrl = dto.published_url;
    submission.publishedAt = new Date();

    // Financial-integrity fix (post-E6 review): the submission write and
    // the payout obligation write below are wrapped in one database
    // transaction so a crash or thrown error between them can never leave
    // a submission marked published with no corresponding payout_obligation
    // row (NFR-13 -- no financial obligation may ever be lost). This is
    // the ACID boundary ADR-0036 and section 2.1 of the E6 architecture
    // document already describe; it was previously missing from the code.
    //
    // gateService.recordPublication runs inside this same block too, since
    // it is the FR-42 completion hook named by the E4/E5 architecture docs
    // as sharing a transaction with the published_url/published_at write
    // (E5 architecture doc section 4.6, step 5). If it throws, the
    // submission write below is rolled back along with it.
    //
    // The audit log write after this block is deliberately left outside
    // the transaction: losing an audit entry (while still writing the
    // submission and the obligation) is not the same severity as losing a
    // financial obligation, and audit_log is append-only, best-effort
    // observability elsewhere in this codebase too, not itself a source of
    // truth NFR-13 protects.
    await this.dataSource.transaction(async (manager) => {
      await manager.save(ContentSubmission, submission);

      // FR-42's completion hook (section 3.6 of the E4 architecture doc),
      // called here, never reimplemented. recordPublication's own
      // defense-in-depth re-check of the gate is intentionally redundant
      // with the check above (ADR-0027).
      await this.gateService.recordPublication(submissionId, dto.published_url);

      // ADR-0036 / FR-44 (E6): the payout obligation is created immediately
      // after the two writes above and before the audit log entry below,
      // participating in this same transaction via the manager passed
      // through. No approval re-check happens here -- gate 1's check above
      // already established it.
      await this.payoutObligationService.createForConfirmedPublication(
        {
          contentSubmissionId: submission.id,
          campaignId: submission.campaignId,
          creatorId: creatorId,
          opportunityId: submission.opportunityId as string,
          publishedAt: submission.publishedAt,
        },
        manager,
      );
    });

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'content_submission.publication_confirmed',
      metadata: { content_submission_id: submissionId, published_url: dto.published_url },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      content_submission_id: submission.id,
      published_url: submission.publishedUrl,
      published_at: submission.publishedAt.toISOString(),
      status: 'confirmed',
    };
  }
}
