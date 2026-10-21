import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentSubmission, ContentReviewDecision, ContentReviewDecisionValue } from '../database/entities';
import { BrandSafetyGateService } from '../brand-safety/brand-safety-gate.service';
import { AuditService } from '../audit/audit.service';
import { ConfirmPublicationDto } from './dto/confirm-publication.dto';
import {
  PUBLICATION_LINK_VERIFIER_ADAPTER,
  PublicationLinkVerifierAdapter,
} from './adapters/publication-link-verifier.adapter';

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
    await this.submissionRepo.save(submission);

    // FR-42's completion hook (section 3.6 of the E4 architecture doc),
    // called here, never reimplemented. recordPublication's own
    // defense-in-depth re-check of the gate is intentionally redundant with
    // the check above (ADR-0027).
    await this.gateService.recordPublication(submissionId, dto.published_url);

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
