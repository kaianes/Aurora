import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ContentSubmission,
  SafetyCheck,
  SafetyCheckStatus,
  SafetyReviewQueueItem,
  ReviewItemStatus,
  PublishedContentSnapshot,
  MonitoringStatus,
} from '../database/entities';

export type GateBlockingReason =
  | 'pending'
  | 'flagged'
  | 'check_unavailable'
  | 'rejected'
  | 'revision_requested'
  | null;

export interface GateStatus {
  cleared: boolean;
  blockingReason: GateBlockingReason;
}

// Section 3.6 of the E4 architecture doc: the entire surface any other
// module -- including a future E5 and a future payments module -- is
// permitted to depend on for brand safety. Neither campaign nor payment code
// may import safety_check, safety_rule, or safety_review_queue_item
// directly (NFR-29).
@Injectable()
export class BrandSafetyGateService {
  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(SafetyCheck)
    private checkRepo: Repository<SafetyCheck>,
    @InjectRepository(SafetyReviewQueueItem)
    private reviewRepo: Repository<SafetyReviewQueueItem>,
    @InjectRepository(PublishedContentSnapshot)
    private snapshotRepo: Repository<PublishedContentSnapshot>,
  ) {}

  // FR-33's enforcement point (section 2.8 of the E4 architecture doc).
  // Computed, never stored: no row, no status, and no error state ever maps
  // to cleared by default (ADR-0023).
  async getGateStatus(contentSubmissionId: string): Promise<GateStatus> {
    const check = await this.checkRepo.findOne({
      where: { contentSubmissionId },
      order: { requestedAt: 'DESC' },
    });

    if (!check || check.status === SafetyCheckStatus.PENDING) {
      return { cleared: false, blockingReason: 'pending' };
    }

    if (check.status === SafetyCheckStatus.PASSED) {
      return { cleared: true, blockingReason: null };
    }

    // flagged or check_unavailable: read alongside the review decision, if any.
    const review = await this.reviewRepo.findOne({ where: { safetyCheckId: check.id } });

    if (!review || review.status === ReviewItemStatus.PENDING) {
      return {
        cleared: false,
        blockingReason: check.status === SafetyCheckStatus.FLAGGED ? 'flagged' : 'check_unavailable',
      };
    }

    if (review.status === ReviewItemStatus.APPROVED) {
      return { cleared: true, blockingReason: null };
    }

    // rejected or revision_requested: blocked permanently for this submission.
    return {
      cleared: false,
      blockingReason: review.status === ReviewItemStatus.REJECTED ? 'rejected' : 'revision_requested',
    };
  }

  // FR-42's completion hook (section 3.6). Defense-in-depth: re-checks the
  // gate itself rather than trusting a caller to have already enforced it
  // (US-16 scenario 3 -- the gate cannot be bypassed from the publication
  // side regardless of who or what initiates the attempt).
  async recordPublication(contentSubmissionId: string, publishedUrl: string): Promise<void> {
    const submission = await this.submissionRepo.findOne({ where: { id: contentSubmissionId } });
    if (!submission) {
      throw new NotFoundException({
        error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
      });
    }

    const gate = await this.getGateStatus(contentSubmissionId);
    if (!gate.cleared) {
      throw new ConflictException({
        error: {
          code: 'SAFETY_NOT_CLEARED',
          message: 'O conteudo ainda nao passou pela verificacao de seguranca da marca.',
          details: { blocking_reason: gate.blockingReason },
        },
      });
    }

    const existing = await this.snapshotRepo.findOne({ where: { contentSubmissionId } });
    const snapshot =
      existing ||
      this.snapshotRepo.create({
        contentSubmissionId,
      });

    snapshot.publishedUrl = publishedUrl;
    snapshot.approvedCaptionText = submission.captionText;
    snapshot.approvedOnScreenText = submission.onScreenText;
    snapshot.approvedAudioTranscript = submission.audioTranscript;
    snapshot.monitoringStatus = MonitoringStatus.ACTIVE;
    snapshot.lastCheckedAt = null;
    snapshot.lastResult = null;
    snapshot.deviationDetails = null;
    snapshot.consecutiveUnreachableCount = 0;

    await this.snapshotRepo.save(snapshot);
  }
}
